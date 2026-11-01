import type { Plugin } from '@opencode/plugin';
import { z } from 'zod';
import { resolveConfig } from './config.js';
import { RunManager } from './manager.js';
import { connectToHost, resolveOriginModel, type Adapter } from './opencode.js';
import { LoopError, projectRoot } from './util.js';

const runId = z.string().regex(/^run_[a-f0-9]+$/);
const changeName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
// Function-tool providers require an object schema at the root. Enforce action-specific
// fields with actionSchema at execution, rather than exposing a root-level union.
export const toolInputSchema = z.strictObject({
  action: z.enum(['run', 'status', 'resume', 'stop']),
  change: changeName.optional().describe('Active change name; only for run. Omit to select the single active change.'),
  runId: runId.optional().describe('Required for resume/stop; optional for status; omitted for run.'),
});
export const actionSchema = z.discriminatedUnion('action', [
  z.strictObject({action: z.literal('run'), change: changeName.optional()}),
  z.strictObject({action: z.literal('status'), runId: runId.optional()}),
  z.strictObject({action: z.literal('resume'), runId}),
  z.strictObject({action: z.literal('stop'), runId}),
]);
export type Action = z.infer<typeof actionSchema>;

export class LoopService {
  constructor(private ctx: Plugin.Context, readonly manager: RunManager,
    private connect: (ctx: Plugin.Context, sessionId: string, server?: string) => Promise<{adapter: Adapter}> = connectToHost) {}
  async execute(sessionId: string, input: unknown, messageId?: string) {
    const action = actionSchema.parse(input);
    const origin = await this.ctx.session.get({sessionID: sessionId});
    if (origin.metadata?.openspecVerifyLoop) throw new LoopError('blocked', 'Loop workers cannot invoke the loop management interface');
    const project = await projectRoot(origin.location.directory);
    const config = resolveConfig(this.ctx.options, project);
    if (action.action === 'status') return this.manager.status(project, config, action.runId);
    const {adapter} = await this.connect(this.ctx, sessionId, config.server);
    if (action.action === 'run') {
      const model = config.verifierModel && config.fixerModel ? undefined : await resolveOriginModel(this.ctx, origin, messageId);
      return this.manager.start(project, config, adapter, action.change, {sessionId, model});
    }
    if (action.action === 'resume') return this.manager.resume(project, config, adapter, action.runId, sessionId);
    return this.manager.stop(project, config, adapter, action.runId);
  }
}
