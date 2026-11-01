import { OpenCode, type OpenCodeClient, type ModelRef, type AgentInfo, type SkillInfo, type SessionMessageInfo } from '@opencode/client';
import { Service, fallback } from '@opencode/client/service';
import { LoopError, OPENCODE_VERSION, command, exists, errorMessage } from './util.js';

export type Model = ModelRef;
export type Catalog = {version: string; agents: AgentInfo[]; skills: SkillInfo[]; defaultModel?: Model;
  models: {id: string; providerID: string; enabled: boolean; variants: string[]}[]};
export type Assignment = {
  sessionId: string; inputId: string; project: string; runId: string; round: number;
  role: 'verifier' | 'fixer'; agent: string; model: Model; prompt: string;
};
export type Observation = {status: 'running'} | {status: 'awaiting_input'; requests: unknown[]} |
  {status: 'completed'; text: string; messageId: string} | {status: 'failed' | 'interrupted'; reason: string};
export interface Adapter {
  catalog(project: string): Promise<Catalog>;
  ensureSession(a: Assignment): Promise<void>;
  ensurePrompt(a: Assignment, allowSubmission?: boolean): Promise<void>;
  observe(a: Assignment): Promise<Observation>;
  interrupt(a: Assignment): Promise<boolean>;
  subscribe?(sessionId: string, signal: AbortSignal, event: (type: string) => void): Promise<void>;
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

export async function connect(server?: string): Promise<OpenCodeAdapter> {
  if (server) {
    const url = new URL(server);
    if (url.username || url.password || url.search || url.hash) throw new Error('Server URL must not contain credentials, query, or fragment');
    const token = process.env.OPENCODE_TOKEN;
    return new OpenCodeAdapter(OpenCode.make({baseUrl: server, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {})}));
  }
  // Never deliberately replace a running service of a different version.
  const existing = await Service.discover({version: () => true});
  if(!existing) {
    if(await exists(fallback())) throw new LoopError('blocked','A registered OpenCode service is unhealthy or incompatible. Start a healthy OpenCode 2.2.5 service or supply --server; the loop will not replace it.');
    const binary=await command(['opencode','--version'],process.cwd());
    if(binary.exitCode || ![OPENCODE_VERSION,`opencode v${OPENCODE_VERSION}`].includes(binary.stdout.trim())) {
      throw new LoopError('blocked',`OpenCode ${OPENCODE_VERSION} is required before starting its service`);
    }
  }
  const endpoint = existing ?? await Service.ensure({version: version=>{
    if(version!==OPENCODE_VERSION)throw new LoopError('blocked',`OpenCode service version changed to ${version}; expected ${OPENCODE_VERSION}`);
    return true;
  }});
  return new OpenCodeAdapter(OpenCode.make({baseUrl: endpoint.url, headers: Service.headers(endpoint)}));
}

export class OpenCodeAdapter implements Adapter {
  constructor(public client: OpenCodeClient) {}
  async catalog(project: string): Promise<Catalog> {
    const location = {directory: project};
    await this.client.location.get({location}, request());
    const [info, agents, models, fallback] = await Promise.all([
      this.client.server.info(request()), this.client.agent.list({location}, request()),
      this.client.model.list({location}, request()),
      this.client.model.default({location}, request()),
    ]);
    const skills = await this.client.skill.list({location}, request());
    if (info.version !== OPENCODE_VERSION) throw new LoopError('blocked', `OpenCode ${OPENCODE_VERSION} is required; server reports ${info.version}`);
    return {version: info.version, agents: agents.data, skills: skills.data,
      ...(fallback.data ? {defaultModel: {id: fallback.data.id, providerID: fallback.data.providerID}} : {}),
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
          permissions: [{action: 'subagent', resource: '*', effect: 'deny'},
            ...(a.role === 'verifier' ? [{action: 'edit', resource: '*', effect: 'deny'} as const] : [])],
        }, request());
      } catch (e) {
        // A lost create response is reconciled by the caller-assigned identity.
        try { session = await this.client.session.get({sessionID: a.sessionId}, request()); } catch { throw e; }
      }
    }
    if (session.agent !== a.agent || session.model?.id !== a.model.id || session.model.providerID !== a.model.providerID ||
        (session.model.variant ?? 'default') !== (a.model.variant ?? 'default') ||
        session.metadata?.openspecVerifyLoop !== a.runId || session.location.directory !== a.project) {
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
    const [session, messages, inbox, permissions, forms] = await Promise.all([
      this.client.session.get({sessionID: a.sessionId}, request()), this.messages(a.sessionId),
      this.client.session.inbox.list({sessionID: a.sessionId}, request()),
      this.client.permission.list({sessionID: a.sessionId}, request()),
      this.client.session.form.list({sessionID: a.sessionId}, request()),
    ]);
    const requests: unknown[] = permissions.map(p => ({type: 'permission', id: p.id, action: p.action, resources: p.resources}));
    for (const f of forms) {
      const detail = await this.client.session.form.get({sessionID: a.sessionId, formID: f.id}, request());
      if (detail.state.status === 'pending') requests.push({type: 'question', id: f.id, title: f.title});
    }
    if (requests.length) return {status: 'awaiting_input', requests};
    const users = messages.filter(m => m.type === 'user');
    if (users.some(m => m.id !== a.inputId) || inbox.some(m => m.id !== a.inputId)) throw new Error('Unexpected worker input; cannot correlate result');
    if (inbox.length) return {status: 'running'};
    const inputIndex = messages.findIndex(m => m.type === 'user' && m.id === a.inputId);
    if (inputIndex < 0) return {status: 'running'};
    const tail = messages.slice(inputIndex + 1);
    const idle = tail.findLast(m => m.type === 'idle');
    if (!idle || idle.type !== 'idle' || (session.time.busy ?? 0) > (session.time.idle ?? 0)) return {status: 'running'};
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
  async subscribe(sessionId: string, signal: AbortSignal, event: (type: string) => void) {
    try {
      for await (const e of this.client.event.subscribe({types: ['session.step.started', 'session.tool.called', 'session.execution.succeeded',
        'session.execution.failed', 'permission.asked', 'form.created'], signal})) {
        if ('data' in e && e.data && 'sessionID' in e.data && e.data.sessionID === sessionId) event(e.type);
      }
    } catch { /* Live events are progress hints; persisted state is authoritative. */ }
  }
}
