import { errorMessage, LoopError, newId } from './util.js';
import type { TrackWorker, WorkerCleanup } from './runner.js';

type StopResult = {outcome: string; runId?: string; reason?: string; originSessionId?: string};
type Run = {runId: string; originSessionId: string; abort: AbortController; promise: Promise<void>;
  worker?: WorkerCleanup; result?: Record<string, unknown>; noticeDelivered?: boolean; reporting?: Promise<void>; stopping?: Promise<StopResult>};
export type Notify = (sessionId: string, result: Record<string, unknown>) => Promise<void>;

export type RunRegistry = {owners: Map<string, RunManager>; pending: Map<string, {project: string; run: Run}>};

/** Owns this plugin generation's runs in memory: one per checkout, aborted on stop and unload. */
export class RunManager {
  private runs = new Map<string, Run>();
  private closed = false;
  constructor(private notify: Notify,
    private registry: RunRegistry = {owners: new Map(), pending: new Map()},
    private log: (message: string) => void = console.error) {}

  private release(project: string, run: Run) {
    if (!run.worker && this.runs.get(project) === run) {
      this.runs.delete(project);
      if (this.registry.owners.get(project) === this) this.registry.owners.delete(project);
    }
  }

  start(project: string, originSessionId: string, execute: (signal: AbortSignal, runId: string, trackWorker: TrackWorker) => Promise<unknown>) {
    if (this.closed) throw new LoopError('blocked', 'The plugin is unloading; try again after reload');
    const existing = this.registry.owners.get(project)?.runs.get(project);
    if (existing) throw new LoopError('blocked', existing.result && existing.worker
      ? `Checkout remains reserved for worker ${existing.worker.sessionId}; retry stop to confirm cleanup`
      : 'A verification loop is already running in this checkout');
    const run: Run = {runId: newId('run'), originSessionId, abort: new AbortController(), promise: Promise.resolve()};
    this.runs.set(project, run);
    this.registry.owners.set(project, this);
    run.promise = (async () => {
      let result: Record<string, unknown>;
      try {
        const value = await execute(run.abort.signal, run.runId, worker => { run.worker = worker; });
        run.abort.signal.throwIfAborted();
        result = {runId: run.runId, ...(value as object)};
      }
      catch (error) {
        result = run.abort.signal.aborted && !run.worker ? {runId: run.runId, status: 'stopped', reason: 'Stopped by user'}
          : {runId: run.runId, status: error instanceof LoopError ? error.outcome : 'failed', reason: errorMessage(error)};
      }
      run.result = result;
      this.registry.pending.set(run.runId, {project, run});
      this.release(project, run);
      if (!this.closed) await this.report(run);
    })();
    return {outcome: 'started', runId: run.runId};
  }
  stop(project: string): Promise<StopResult> {
    const owner = this.registry.owners.get(project);
    if (owner && owner !== this) return owner.stop(project);
    const run = this.runs.get(project);
    if (!run) return Promise.resolve({outcome: 'not_running', reason: 'No verification loop is running in this checkout'});
    return run.stopping ??= (async () => {
      const executing = !run.result;
      if (executing) {
        run.abort.abort(new LoopError('stopped', 'Stopped by user'));
        await run.promise;
      } else if (run.worker) {
        try { await run.worker.interrupt(); }
        catch (error) { return {outcome: 'failed', runId: run.runId, reason: errorMessage(error)}; }
      }
      this.release(project, run);
      // Present only when this invocation already answered the origin through the terminal notice.
      const answered = executing && run.noticeDelivered ? {originSessionId: run.originSessionId} : {};
      return run.worker ? {outcome: 'failed', runId: run.runId, reason: String(run.result?.reason), ...answered}
        : {outcome: 'stopped', runId: run.runId, ...answered};
    })().finally(() => { run.stopping = undefined; });
  }
  async close() {
    this.closed = true;
    const runs = [...this.runs.entries()];
    const results = await Promise.all(runs.map(([project]) => this.stop(project)));
    await Promise.all(runs.map(([, run]) => run.promise));
    const failures = results.filter(result => result.outcome === 'failed');
    if (failures.length) throw new LoopError('failed', failures.map(result => result.reason).join('\n'));
  }
  async retryReports(project: string) {
    const pending = [...this.registry.pending.values()].filter(entry => entry.project === project);
    await Promise.all(pending.map(({run}) => this.report(run)));
    return {outcome: 'reports', results: pending.map(({run}) => ({result: run.result, delivered: !!run.noticeDelivered}))};
  }
  async reportRetainedFailures() {
    for (const run of this.runs.values()) await this.report(run);
  }
  private async report(run: Run) {
    if (!run.result || run.noticeDelivered) return;
    return run.reporting ??= (async () => {
      try {
        await this.notify(run.originSessionId, run.result!);
        run.noticeDelivered = true;
        this.registry.pending.delete(run.runId);
      } catch (error) {
        this.log(`OpenSpec loop ${run.runId} notice delivery failed: ${errorMessage(error)}`);
      }
    })().finally(() => { run.reporting = undefined; });
  }
}
