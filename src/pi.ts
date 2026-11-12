import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { PiService, type PiReport } from './pi-service.js';
import type { PiRun } from './pi-runtime.js';
import { errorMessage } from './util.js';

export function renderRun(run: PiRun, reports = true, activity?: number): string {
  const state = run.cleanup ? 'failed (cleanup unconfirmed)' : run.state === 'terminal' ? run.result?.status ?? 'failed' : run.state;
  const rounds = run.result && 'rounds' in run.result ? run.result.rounds : run.calls.filter(call => call.role === 'verifier').length;
  const change = run.result && 'change' in run.result ? run.result.change : run.args.change;
  const lines = [`OpenSpec loop ${run.id}: ${state}`, `Change: ${change ?? 'not selected'}; verifications: ${rounds}`,
    run.cleanup ?? run.result?.reason ?? run.calls.at(-1)?.label ?? 'Waiting to verify'];
  const last = run.calls.at(-1);
  if (activity !== undefined && last && last.reply === null && last.failure === null) {
    lines.push(`Last worker activity: ${new Date(activity).toISOString()} (${Math.round((Date.now() - activity) / 1000)} s before this report)`);
  }
  if (reports) for (const call of run.calls) lines.push(`\n${call.label} (conversation ${call.conversation}, submission ${call.submission ?? 'not admitted'}):\n${call.reply ?? call.failure ?? 'Unfinished'}`);
  return lines.join('\n');
}

/** Native Pi entry. Session resources are created only by explicit commands. */
export default function plugin(pi: ExtensionAPI): void {
  let service: PiService | undefined;
  let actions: Promise<void> = Promise.resolve();
  let unloading = false;
  const display = (run: PiRun, event: string, reports = true, activity?: number) => pi.sendMessage({customType: 'openspec-verify-loop',
    content: renderRun(run, reports, activity), display: true, details: {event, run}}, {triggerTurn: false});
  for (const [name, action, description] of [
    ['opsx-verify-loop', 'start', 'Verify and fix a change: [change] [--store <id>] [--max-rounds <n>]'],
    ['opsx-verify-loop-report', 'report', 'Show saved loop progress and full reports: [run-id]'],
    ['opsx-verify-loop-stop', 'stop', 'Stop loop work after confirmed cleanup: [run-id]'],
    ['opsx-verify-loop-resume', 'resume', 'Explicitly resume an interrupted loop: [run-id]'],
  ] as const) pi.registerCommand(name, {description, handler: (text, ctx) => {
    const operation = actions.then(async () => {
      try {
        if (unloading) throw new Error('Pi loop extension is shutting down');
        service ??= new PiService(pi, notice => display(notice.run, notice.event, notice.event !== 'progress'));
        const run: PiReport = await service[action](text, ctx);
        if (action === 'report' || action === 'stop') display(run, action, true, action === 'report' ? run.activity : undefined);
      } catch (error) {
        pi.sendMessage({customType: 'openspec-verify-loop', content: `OpenSpec loop ${action} failed: ${errorMessage(error)}`,
          display: true, details: {event: 'error', action, reason: errorMessage(error)}}, {triggerTurn: false});
      }
    });
    actions = operation.catch(() => {});
    return operation;
  }});
  pi.on('session_shutdown', async () => {unloading = true; await actions; await service?.shutdown();});
}
