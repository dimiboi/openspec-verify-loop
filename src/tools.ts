import type { Plugin } from '@opencode/plugin';
import { z } from 'zod';
import { actionSchema, toolInputSchema, type LoopService } from './service.js';
import { failureResult } from './commands.js';
import { MANAGEMENT_TOOL } from './workers.js';

export async function registerTool(ctx: Plugin.Context, service: LoopService) {
  return ctx.tool.transform(editor => editor.add({
    name: MANAGEMENT_TOOL,
    description: 'Run, inspect, resume, or stop the OpenSpec verification/fix loop. Each worker uses fresh context. Start returns a durable run ID; inspect status while server-owned work proceeds.',
    input: z.toJSONSchema(toolInputSchema), options: {permission: MANAGEMENT_TOOL},
    async execute(input, tool) {
      // Guard before permission assertions so a worker can never recursively dispatch.
      const session = await ctx.session.get({sessionID: tool.sessionID});
      if (session.metadata?.openspecVerifyLoop) throw new Error('Loop workers cannot invoke loop management');
      const action = actionSchema.parse(input);
      if (action.action !== 'status') await ctx.permission.assert({sessionID: tool.sessionID, agent: tool.agent,
        action: MANAGEMENT_TOOL, resources: [action.action],
        source: {type: 'tool', messageID: tool.messageID, id: tool.id}});
      let result: unknown;
      try { result = await service.execute(tool.sessionID, action); }
      catch (error) { result = failureResult(error); }
      return {content: JSON.stringify(result)};
    },
  }));
}
