import type { Plugin } from '@opencode/plugin';
import { actionSchema, type Action, type LoopService } from './service.js';
import { errorMessage, LoopError } from './util.js';

export const commandActions = {'opsx-verify-loop': 'run', 'opsx-verify-loop-stop': 'stop'} as const;
export function parseCommand(name: keyof typeof commandActions, text: string): Action {
  const args = text.trim() ? text.trim().split(/\s+/) : [];
  const action = commandActions[name];
  if (args.length > (action === 'run' ? 1 : 0)) throw new Error(`/${name} accepts ${action === 'run' ? 'one change name' : 'no arguments'}`);
  return actionSchema.parse({action, ...(args[0] ? {change: args[0]} : {})});
}
export function failureResult(error: unknown) {
  return {outcome: error instanceof LoopError ? error.outcome : 'failed', reason: errorMessage(error)};
}
export async function registerCommands(ctx: Plugin.Context, service: LoopService, notice: (sessionId: string, value: unknown) => Promise<void>) {
  return ctx.command.transform(editor => {
    for (const name of Object.keys(commandActions) as (keyof typeof commandActions)[]) editor.add({
      name, description: commandActions[name] === 'run' ? 'Verify and fix an OpenSpec change until clean' : 'Stop the running verification loop',
      async execute({sessionID, prompt}) {
        let result: unknown;
        try { result = await service.execute(sessionID, parseCommand(name, prompt.text)); }
        catch (error) { result = failureResult(error); }
        // The run's own notice already tells its starting session that it stopped.
        const stopped = result as {outcome?: string; originSessionId?: string};
        if (stopped.outcome === 'stopped' && stopped.originSessionId === sessionID) return;
        await notice(sessionID, result);
      },
    });
  });
}
