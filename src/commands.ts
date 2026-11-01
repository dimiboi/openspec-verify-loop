import type { Plugin } from '@opencode/plugin';
import { actionSchema, type Action, type LoopService } from './service.js';
import { errorMessage, LoopError } from './util.js';

export const commandActions = {
  'verify-loop': 'run', 'verify-loop-status': 'status',
  'verify-loop-resume': 'resume', 'verify-loop-stop': 'stop',
} as const;
export function parseCommand(name: keyof typeof commandActions, text: string): Action {
  const args = text.trim() ? text.trim().split(/\s+/) : [];
  if (args.length > 1) throw new Error(`/${name} accepts ${commandActions[name] === 'run' ? 'one change name' : 'one run ID'}`);
  const action = commandActions[name];
  return actionSchema.parse({action, ...(args[0] ? {[action === 'run' ? 'change' : 'runId']: args[0]} : {})});
}
export function failureResult(error: unknown) {
  return {outcome: error instanceof LoopError ? error.outcome : 'failed', reason: errorMessage(error),
    ...(error instanceof LoopError && error.details !== undefined ? {details: error.details} : {})};
}
export async function registerCommands(ctx: Plugin.Context, service: LoopService, notice: (sessionId: string, value: unknown) => Promise<void>) {
  return ctx.command.transform(editor => {
    for (const name of Object.keys(commandActions) as (keyof typeof commandActions)[]) editor.add({
      name, description: ({run: 'Verify and fix an OpenSpec change until clean', status: 'Inspect verification runs',
        resume: 'Explicitly resume a saved verification run', stop: 'Stop a verification run'})[commandActions[name]],
      async execute({sessionID, prompt}) {
        let result: unknown;
        try { result = await service.execute(sessionID, parseCommand(name, prompt.text)); }
        catch (error) { result = failureResult(error); }
        await notice(sessionID, result);
      },
    });
  });
}
