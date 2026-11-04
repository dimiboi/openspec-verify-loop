import { Plugin, Skill } from '@opencode/plugin';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { configSchema } from './config.js';
import { registerCommands } from './commands.js';
import { RunManager } from './manager.js';
import { LoopService } from './service.js';
import { registerTool } from './tools.js';
import { MANAGEMENT_TOOL } from './workers.js';
import { OPENCODE_VERSION } from './util.js';

export const PLUGIN_ID = 'openspec.verify-loop';

/** Constrain reporting turns and prevent workers from seeing loop controls. */
export async function protectContext(ctx: Plugin.Context, event: Parameters<Parameters<Plugin.Context['session']['hook']>[1]>[0]) {
  // Registered specifically on the context hook; the generic hook type includes other events.
  if (!('tools' in event)) return;
  const session = await ctx.session.get({sessionID: event.sessionID});
  if (session.metadata?.openspecVerifyLoop) {
    delete event.tools[MANAGEMENT_TOOL];
    return;
  }
  const messages = await ctx.session.context({sessionID: event.sessionID});
  const input = messages.findLast(message => message.type === 'user' || message.type === 'synthetic');
  if (input?.type === 'synthetic' && input.metadata?.openspecLoopNotice === true) {
    event.tools = {};
    event.system.push({type: 'text', text: 'This turn only reports the latest OpenSpec loop notice. State its status, change, round count and reason concisely, and summarize any remaining issues, or the checks it lists as Not verified, from its report. Do not perform work, invoke tools, start another run, or claim clean unless the notice says clean.'});
  }
}

export async function setupPlugin(ctx: Plugin.Context) {
  if (ctx.app.version !== OPENCODE_VERSION) throw new Error(`openspec-verify-loop requires OpenCode ${OPENCODE_VERSION}`);
  configSchema.parse(ctx.options);
  let unloading = false;
  const notice = async (sessionId: string, result: unknown) => {
    if (unloading) return;
    await ctx.session.synthetic({sessionID: sessionId,
      text: `OpenSpec verification loop result (report only; no action requested):\n${JSON.stringify(result)}`,
      description: 'OpenSpec verification loop', metadata: {openspecLoopNotice: true},
      delivery: 'queue', resume: true});
  };
  const manager = new RunManager(notice);
  const service = new LoopService(ctx, manager);
  const registrations: {dispose(): Promise<void>}[] = [];
  try {
    registrations.push(await ctx.session.hook('context', event => protectContext(ctx, event)));
    registrations.push(await registerTool(ctx, service));
    const skillPath = fileURLToPath(new URL('../opencode/SKILL.md', import.meta.url));
    const content = await readFile(skillPath, 'utf8');
    registrations.push(await ctx.skill.transform(editor => editor.add({
      id: Skill.ID.make('openspec-verify-loop'), name: Skill.Name.make('openspec-verify-loop'),
      description: 'Verify an OpenSpec change, fix all findings with fresh workers, and repeat until clean',
      path: Skill.Info.fields.path.make(skillPath), content,
    })));
    registrations.push(await registerCommands(ctx, service, notice));
  } catch (error) {
    unloading = true;
    await manager.close();
    await Promise.allSettled(registrations.reverse().map(registration => registration.dispose()));
    throw error;
  }
  let cleanup: Promise<void> | undefined;
  return () => cleanup ??= (async () => {
    unloading = true;
    await manager.close();
    await Promise.all(registrations.reverse().map(registration => registration.dispose()));
  })();
}

export default Plugin.define({id: PLUGIN_ID, setup: setupPlugin});
