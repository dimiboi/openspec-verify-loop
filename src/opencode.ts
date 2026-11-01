import { OpenCode, type OpenCodeClient, type ModelRef, type AgentInfo, type SkillInfo, type SessionMessageInfo, type SessionInfo } from '@opencode/client';
import { Service } from '@opencode/client/service';
import type { Plugin } from '@opencode/plugin';
import type { Permission } from './workers.js';
import { LoopError, OPENCODE_VERSION, errorMessage, digest } from './util.js';

export type Model = ModelRef;
export type Catalog = {version: string; agents: AgentInfo[]; skills: SkillInfo[]; defaultModel?: Model;
  models: {id: string; providerID: string; enabled: boolean; variants: string[]}[]};
export type Assignment = {
  sessionId: string; inputId: string; project: string; runId: string; round: number;
  role: 'verifier' | 'fixer'; agent: string; model: Model; permissions: Permission[]; prompt: string;
};
export type Observation = {status: 'running'} | {status: 'awaiting_input'; requests: unknown[]} |
  {status: 'completed'; text: string; messageId: string} | {status: 'failed' | 'interrupted'; reason: string};
export interface Adapter {
  catalog(project: string): Promise<Catalog>;
  ensureSession(a: Assignment): Promise<void>;
  ensurePrompt(a: Assignment, allowSubmission?: boolean): Promise<void>;
  observe(a: Assignment): Promise<Observation>;
  interrupt(a: Assignment): Promise<boolean>;
}
const request = () => ({signal: AbortSignal.timeout(20_000)});
function isMissing(e: unknown) { return (e as {_tag?: string})?._tag === 'SessionNotFoundError'; }

export function parseModel(input: string): Model {
  const slash = input.indexOf('/');
  if (slash < 1 || slash === input.length - 1) throw new Error('Model must be provider/model[#variant]');
  const rest = input.slice(slash + 1);
  const hash = rest.lastIndexOf('#');
  const id = hash < 0 ? rest : rest.slice(0, hash);
  const variant = hash < 0 ? undefined : rest.slice(hash + 1);
  if (!id || variant === '') throw new Error('Invalid model reference');
  return {providerID: input.slice(0, slash), id, ...(variant ? {variant} : {})};
}

/** A tool call belongs to its generating turn, even if the client switches models while it waits. */
export async function resolveOriginModel(ctx: Pick<Plugin.Context, 'session'>, origin: SessionInfo, messageId?: string): Promise<Model | undefined> {
  if (!messageId && origin.model) return {...origin.model};
  const messages = await ctx.session.context({sessionID: origin.id}, request());
  if (messageId) {
    const message = messages.find(message => message.id === messageId);
    if (message?.type !== 'assistant') {
      throw new LoopError('blocked', `Cannot identify the invoking model for message ${messageId} in session ${origin.id}`);
    }
    return {...message.model};
  }
  // Native commands have no assistant turn. Recover the last effective selection
  // from this session when its optional model field has not been populated.
  const selected = messages.findLast(message => message.type === 'assistant' || message.type === 'model-switched');
  return selected && 'model' in selected ? {...selected.model} : undefined;
}

/** Bind the recovery client to this plugin's hosting server; never manage a service. */
export async function connectToHost(ctx: Pick<Plugin.Context, 'app' | 'session'>, sessionId: string, server?: string) {
  if (ctx.app.version !== OPENCODE_VERSION) throw new LoopError('blocked', `OpenCode ${OPENCODE_VERSION} is required`);
  const origin = await ctx.session.get({sessionID: sessionId}, request());
  let client: OpenCodeClient;
  if (server) {
    const url = new URL(server);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Host endpoint must be an HTTP(S) URL without credentials, query, or fragment');
    }
    const token = process.env.OPENCODE_TOKEN;
    client = OpenCode.make({baseUrl: server, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {})});
  } else {
    const endpoint = await Service.discover({version: OPENCODE_VERSION});
    if (!endpoint) throw new LoopError('blocked', 'Cannot discover the hosting OpenCode service; set the plugin server option for a non-registered host');
    client = OpenCode.make({baseUrl: endpoint.url, headers: Service.headers(endpoint)});
  }
  await assertHostingServer(ctx.app.version, origin, client);
  return {adapter: new OpenCodeAdapter(client)};
}

export async function assertHostingServer(version: string, origin: Awaited<ReturnType<Plugin.Context['session']['get']>>, client: OpenCodeClient) {
  const [info, remote] = await Promise.all([
    client.server.info(request()), client.session.get({sessionID: origin.id}, request()),
  ]);
  if (info.pid !== process.pid || info.version !== version || remote.id !== origin.id ||
      remote.time.created !== origin.time.created || remote.location.directory !== origin.location.directory ||
      digest(JSON.stringify(remote.metadata ?? {})) !== digest(JSON.stringify(origin.metadata ?? {}))) {
    throw new LoopError('blocked', 'The recovery endpoint is not this plugin hosting server');
  }
}

export class OpenCodeAdapter implements Adapter {
  constructor(public client: OpenCodeClient) {}
  async catalog(project: string): Promise<Catalog> {
    const location = {directory: project};
    await this.client.location.get({location}, request());
    const [info, agents, models] = await Promise.all([
      this.client.server.info(request()), this.client.agent.list({location}, request()),
      this.client.model.list({location}, request()),
    ]);
    const skills = await this.client.skill.list({location}, request());
    if (info.version !== OPENCODE_VERSION) throw new LoopError('blocked', `OpenCode ${OPENCODE_VERSION} is required; server reports ${info.version}`);
    return {version: info.version, agents: agents.data, skills: skills.data,
      models: models.data.map(m => ({id: m.id, providerID: m.providerID, enabled: m.enabled, variants: m.variants.map(v => v.id)}))};
  }
  async ensureSession(a: Assignment) {
    let session;
    try { session = await this.client.session.get({sessionID: a.sessionId}, request()); }
    catch (e) { if (!isMissing(e)) throw e; }
    if (!session) {
      try {
        session = await this.client.session.create({id: a.sessionId, agent: a.agent, model: a.model,
          location: {directory: a.project}, title: `OpenSpec ${a.role} ${a.round}: ${a.runId}`,
          metadata: {openspecVerifyLoop: a.runId, inputId: a.inputId},
          permissions: a.permissions,
        }, request());
      } catch (e) {
        // A lost create response is reconciled by the caller-assigned identity.
        try { session = await this.client.session.get({sessionID: a.sessionId}, request()); } catch { throw e; }
      }
    }
    this.validateSession(a, session);
  }
  private validateSession(a: Assignment, session: SessionInfo) {
    if (session.agent !== a.agent || session.model?.id !== a.model.id || session.model.providerID !== a.model.providerID ||
        (session.model.variant ?? 'default') !== (a.model.variant ?? 'default') ||
        session.metadata?.openspecVerifyLoop !== a.runId || session.metadata?.inputId !== a.inputId || session.location.directory !== a.project ||
        digest(JSON.stringify(session.permissions)) !== digest(JSON.stringify(a.permissions))) {
      throw new Error(`Session identity/configuration mismatch: ${JSON.stringify({agent: session.agent, model: session.model,
        location: session.location, runId: session.metadata?.openspecVerifyLoop, expected: {agent: a.agent, model: a.model, project: a.project, runId: a.runId}})}`);
    }
  }
  async ensurePrompt(a: Assignment, allowSubmission = true) {
    const [messages, inbox] = await Promise.all([
      this.messages(a.sessionId), this.client.session.inbox.list({sessionID: a.sessionId}, request()),
    ]);
    const users = messages.filter(m => m.type === 'user');
    if (users.some(m => m.id !== a.inputId) || inbox.some(m => m.id !== a.inputId)) throw new Error('Unexpected input in worker session');
    const delivered = users.find(m => m.id === a.inputId);
    const queued = inbox.find(m => m.id === a.inputId);
    if (delivered) {
      if (delivered.type !== 'user' || delivered.text !== a.prompt) throw new Error('Existing input does not match dispatch');
      return;
    }
    if (queued) {
      if (queued.type !== 'user' || queued.payload.text !== a.prompt) throw new Error('Existing queued input does not match dispatch');
      return;
    }
    if (!allowSubmission) throw new LoopError('blocked', 'Prompt admission is uncertain and no saved input is visible; no automatic resubmission is safe. Inspect/stop this worker before starting another run.');
    // Duplicate IDs can restart an already completed execution in 2.2.5. Never retry an uncertain submission.
    await this.client.session.prompt({sessionID: a.sessionId, id: a.inputId, text: a.prompt,
      metadata: {openspecVerifyLoop: a.runId}, delivery: 'queue'}, request());
  }
  async messages(sessionID: string): Promise<SessionMessageInfo[]> {
    const result: SessionMessageInfo[] = [];
    let cursor: string | undefined;
    const visited = new Set<string>();
    do {
      const page = await this.client.message.list({sessionID, limit: 100, ...(cursor ? {cursor} : {order: 'asc' as const})}, request());
      result.push(...page.data);
      cursor = page.cursor.next ?? undefined;
      if (cursor && visited.has(cursor)) throw new Error('Repeated message cursor');
      if (cursor) visited.add(cursor);
      if (result.length > 20_000) throw new Error('Worker transcript exceeds collection limit');
    } while (cursor);
    return result;
  }
  async observe(a: Assignment): Promise<Observation> {
    const [session, permissions, forms] = await Promise.all([
      this.client.session.get({sessionID: a.sessionId}, request()),
      this.client.permission.list({sessionID: a.sessionId}, request()),
      this.client.session.form.list({sessionID: a.sessionId}, request()),
    ]);
    this.validateSession(a, session);
    const requests: unknown[] = permissions.map(p => ({type: 'permission', id: p.id, action: p.action, resources: p.resources}));
    for (const f of forms) {
      const detail = await this.client.session.form.get({sessionID: a.sessionId, formID: f.id}, request());
      if (detail.state.status === 'pending') requests.push({type: 'question', id: f.id, title: f.title});
    }
    if (requests.length) return {status: 'awaiting_input', requests};
    // A busy session cannot have finished; collect the transcript only once it looks idle.
    if ((session.time.busy ?? 0) > (session.time.idle ?? 0)) return {status: 'running'};
    const [messages, inbox] = await Promise.all([
      this.messages(a.sessionId), this.client.session.inbox.list({sessionID: a.sessionId}, request()),
    ]);
    const users = messages.filter(m => m.type === 'user');
    if (users.some(m => m.id !== a.inputId) || inbox.some(m => m.id !== a.inputId)) throw new Error('Unexpected worker input; cannot correlate result');
    if (inbox.length) return {status: 'running'};
    const inputIndex = messages.findIndex(m => m.type === 'user' && m.id === a.inputId);
    if (inputIndex < 0) return {status: 'running'};
    const tail = messages.slice(inputIndex + 1);
    const idle = tail.findLast(m => m.type === 'idle');
    if (!idle || idle.type !== 'idle') return {status: 'running'};
    if (idle.outcome !== 'succeeded' || session.outcome !== 'succeeded') {
      return {status: idle.outcome === 'interrupted' ? 'interrupted' : 'failed', reason: JSON.stringify(idle.error ?? {outcome: idle.outcome})};
    }
    const final = tail.findLast(m => m.type === 'assistant');
    if (!final || final.type !== 'assistant' || final.error || final.finish !== 'stop' || !final.time.completed) {
      return {status: 'failed', reason: 'Worker ended without a complete final assistant response'};
    }
    if (final.agent !== a.agent || final.model.id !== a.model.id || final.model.providerID !== a.model.providerID ||
        (final.model.variant ?? 'default') !== (a.model.variant ?? 'default')) {
      return {status: 'failed', reason: 'Worker changed agent or model'};
    }
    return {status: 'completed', messageId: final.id, text: final.content.filter(c => c.type === 'text').map(c => c.text).join('\n')};
  }
  async interrupt(a: Assignment): Promise<boolean> {
    try {
      // Cancel an admitted-but-not-delivered input as well as active execution.
      const inbox = await this.client.session.inbox.list({sessionID: a.sessionId}, request());
      for (const item of inbox) await this.client.session.inbox.cancel({sessionID: a.sessionId, inboxID: item.id}, request());
      await this.client.session.interrupt({sessionID: a.sessionId, resume: false}, request());
      await this.client.experimental.session.wait({sessionID: a.sessionId}, request());
      const [s, active, remaining] = await Promise.all([
        this.client.session.get({sessionID: a.sessionId}, request()), this.client.session.active(request()),
        this.client.session.inbox.list({sessionID: a.sessionId}, request()),
      ]);
      return !active[a.sessionId] && !remaining.length && (s.time.busy ?? 0) <= (s.time.idle ?? 0);
    } catch (e) { if (isMissing(e)) return true; throw new Error(`Cannot confirm worker interruption: ${errorMessage(e)}`); }
  }
}
