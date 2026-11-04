import { errorMessage, LoopError, newId } from './util.js';

type Run = {runId: string; originSessionId: string; abort: AbortController; promise: Promise<void>};
export type Notify = (sessionId: string, result: Record<string, unknown>) => Promise<void>;

/** Owns this plugin generation's runs in memory: one per checkout, aborted on stop and unload. */
export class RunManager {
  private runs = new Map<string, Run>();
  private closed = false;
  constructor(private notify: Notify) {}

  start(project: string, originSessionId: string, execute: (signal: AbortSignal, runId: string) => Promise<unknown>) {
    if (this.closed) throw new LoopError('blocked', 'The plugin is unloading; try again after reload');
    if (this.runs.has(project)) throw new LoopError('blocked', 'A verification loop is already running in this checkout');
    const run: Run = {runId: newId('run'), originSessionId, abort: new AbortController(), promise: Promise.resolve()};
    this.runs.set(project, run);
    run.promise = (async () => {
      let result: Record<string, unknown>;
      try { result = {runId: run.runId, ...(await execute(run.abort.signal, run.runId) as object)}; }
      catch (error) {
        result = run.abort.signal.aborted ? {runId: run.runId, status: 'stopped', reason: 'Stopped by user'}
          : {runId: run.runId, status: error instanceof LoopError ? error.outcome : 'failed', reason: errorMessage(error)};
      }
      this.runs.delete(project);
      if (!this.closed) await this.notify(originSessionId, result).catch(() => {});
    })();
    return {outcome: 'started', runId: run.runId};
  }
  async stop(project: string) {
    const run = this.runs.get(project);
    if (!run) return {outcome: 'not_running', reason: 'No verification loop is running in this checkout'};
    run.abort.abort(new LoopError('stopped', 'Stopped by user'));
    await run.promise;
    return {outcome: 'stopped', runId: run.runId, originSessionId: run.originSessionId};
  }
  async close() {
    this.closed = true;
    const runs = [...this.runs.values()];
    for (const run of runs) run.abort.abort(new LoopError('stopped', 'Plugin unloading'));
    await Promise.all(runs.map(run => run.promise));
  }
}
