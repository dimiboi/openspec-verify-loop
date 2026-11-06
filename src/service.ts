import type { Plugin } from '@opencode/plugin';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { configSchema } from './config.js';
import { loadScript, runScript } from './loop.js';
import { RunManager } from './manager.js';
import { connectToHost, resolveOriginModel, type Catalog, type Model, type OpenCodeAdapter } from './opencode.js';
import { createAgent } from './runner.js';
import { LoopError, projectRoot, sessionDirectory } from './util.js';

const changeName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const storeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const maxRounds = z.number().int().positive();
// Function-tool providers require an object schema at the root. Enforce action-specific
// fields with actionSchema at execution, rather than exposing a root-level union.
export const toolInputSchema = z.strictObject({
  action: z.enum(['run', 'stop', 'report']),
  change: changeName.optional().describe('Change name; only for run. Omit to let the first verifier select the active change.'),
  store: storeId.optional().describe('OpenSpec store ID; only for run.'),
  maxRounds: maxRounds.optional().describe('Verification round limit; only for run. Default 5.'),
});
export const actionSchema = z.discriminatedUnion('action', [
  z.strictObject({action: z.literal('run'), change: changeName.optional(), store: storeId.optional(), maxRounds: maxRounds.optional()}),
  z.strictObject({action: z.literal('stop')}),
  z.strictObject({action: z.literal('report')}),
]);
export type Action = z.infer<typeof actionSchema>;

export class LoopService {
  constructor(private ctx: Plugin.Context, readonly manager: RunManager,
    private connect: (ctx: Plugin.Context, sessionId: string, server?: string) => Promise<{adapter: OpenCodeAdapter}> = connectToHost,
    private pollMs?: number) {}
  async execute(sessionId: string, input: unknown, messageId?: string) {
    const action = actionSchema.parse(input);
    const origin = await this.ctx.session.get({sessionID: sessionId});
    if (origin.metadata?.openspecVerifyLoop) throw new LoopError('blocked', 'Loop workers cannot invoke the loop management interface');
    const locationRoot = await projectRoot(origin.location.directory);
    const directory = await realpath(sessionDirectory(origin, locationRoot));
    const project = await projectRoot(directory);
    if (action.action === 'stop') return this.manager.stop(project);
    if (action.action === 'report') return this.manager.retryReports(project);
    const config = configSchema.parse(this.ctx.options);
    const {adapter} = await this.connect(this.ctx, sessionId, config.server);
    const model = await resolveOriginModel(this.ctx, origin, messageId);
    if (!model) throw new LoopError('blocked', 'Cannot identify the invoking model; select a model in this session');
    const catalog = await adapter.catalog(directory);
    if (!isAvailable(model, catalog.models)) {
      throw new LoopError('blocked', `Unavailable model ${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ''}`);
    }
    const skills = catalog.skills.filter(skill => skill.id === 'openspec-verify-change' || skill.name === 'openspec-verify-change');
    if (!skills.length) throw new LoopError('blocked', 'The openspec-verify-change skill is missing; enable the OpenSpec verify workflow and run `openspec update`');
    if (skills.length > 1) throw new LoopError('blocked', `Expected one openspec-verify-change skill, found ${skills.length}: ${skills.map(skill => skill.path).join(', ')}`);
    const source = await loadScript();
    const args = {change: action.change, store: action.store, maxRounds: action.maxRounds ?? config.maxRounds, procedurePath: skills[0]!.path};
    const started = this.manager.start(project, sessionId, (signal, runId, trackWorker) => runScript(source, {
      agent: createAgent({adapter, project, directory, runId, model, signal, trackWorker, pollMs: this.pollMs}),
      phase: () => {}, log: () => {}, args, budget: () => ({maxAgentCalls: Number.MAX_SAFE_INTEGER}),
    }));
    return {...started, model};
  }
}

// Hosts report the implicit base configuration as variant "default" without listing it.
function isAvailable(model: Model, models: Catalog['models']) {
  const available = models.find(m => m.providerID === model.providerID && m.id === model.id && m.enabled);
  return !!available && (!model.variant || model.variant === 'default' || available.variants.includes(model.variant));
}
