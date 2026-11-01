import { randomUUID } from 'node:crypto';
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { executeLoop, prepareRun, prepareResume, stopRun, type LoopOptions } from './controller.js';
import type { Adapter, Model } from './opencode.js';
import type { Config } from './config.js';
import { atomicWrite, defaultStateRoot, loadRun, projectRunsDirectory, runDirectory, RunStore, type RunState } from './state.js';
import { digest, errorMessage, LoopError } from './util.js';

export function runSummary(state: RunState) {
  return {outcome: state.phase, runId: state.runId, runDir: state.runDir, change: state.pins.changeName,
    round: state.round, reason: state.reason, executor: state.executor, requests: state.requests,
    pending: state.pending ? {sessionId: state.pending.assignment.sessionId, role: state.pending.assignment.role} : undefined,
    models: state.pins.models, workers: state.workers, unresolvedFindings: state.prior, reports: join(state.runDir, 'rounds')};
}
type Task = {store: RunStore; abort: AbortController; promise: Promise<void>};
export type ManagerOptions = Pick<LoopOptions, 'lockRoot' | 'pollMs'> & {
  notify?: (state: RunState) => Promise<void>;
  stopWaitMs?: number;
};

/** Owns asynchronous work for one plugin generation, including its shutdown. */
export class RunManager {
  readonly runtimeId = randomUUID();
  private closed = false;
  private active = new Map<string, Task>();
  private paused = new Map<string, {state: RunState; adapter: Adapter}>();
  private operations = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  constructor(private options: ManagerOptions = {}) {}

  private perform<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new LoopError('blocked', 'The plugin is unloading; try again after reload'));
    const promise = work();
    this.operations.add(promise);
    void promise.finally(() => this.operations.delete(promise)).catch(() => {});
    return promise;
  }
  private launch(store: RunStore, adapter: Adapter) {
    const project = store.state.project;
    const abort = new AbortController();
    if (this.closed) abort.abort();
    const task: Task = {store, abort, promise: Promise.resolve()};
    this.paused.delete(project);
    this.active.set(project, task);
    task.promise = Promise.resolve().then(async () => {
      try {
        await executeLoop(store, adapter, {...this.options, signal: abort.signal});
      } catch (error) {
        // Persistence failures must not silently free an uncertain worker's lease.
        store.state.phase = 'failed'; store.state.reason = errorMessage(error);
        await store.event('controller_error', {reason: store.state.reason}).catch(() => {});
        await store.save().catch(() => {});
      }
      if (store.state.pending) this.paused.set(project, {state: store.state, adapter});
      try { await this.options.notify?.(store.state); }
      catch (error) { await store.event('notice_failed', {reason: errorMessage(error)}).catch(() => {}); }
    }).finally(() => { if (this.active.get(project) === task) this.active.delete(project); });
    return {...runSummary(store.state), outcome: 'started'};
  }
  start(project: string, config: Config, adapter: Adapter, change?: string, origin?: {sessionId: string; model?: Model}) {
    return this.perform(async () => {
      if (this.active.has(project)) throw new LoopError('blocked', 'A verification loop is already running in this checkout');
      const store = await prepareRun(project, config, adapter, change, {...this.options,
        runtimeId: this.runtimeId, originSessionId: origin?.sessionId, originModel: origin?.model});
      return this.launch(store, adapter);
    });
  }
  private async store(project: string, config: Config, runId: string) {
    const root = await realpath(config.stateDir ?? defaultStateRoot());
    return new RunStore(await loadRun(runDirectory(root, project, runId), project), this.options.lockRoot, this.runtimeId);
  }
  async status(project: string, config: Config, runId?: string) {
    if (runId) return runSummary((await this.store(project, config, runId)).state);
    let names: string[];
    try { names = await readdir(projectRunsDirectory(config.stateDir ?? defaultStateRoot(), project)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {outcome: 'status', runs: []}; throw error; }
    const runs = await Promise.all(names.filter(name => /^run_[a-f0-9]+$/.test(name)).map(async name => {
      const store = await this.store(project, config, name);
      return {summary: runSummary(store.state), updatedAt: store.state.updatedAt};
    }));
    return {outcome: 'status', runs: runs.sort((a,b) => b.updatedAt - a.updatedAt).map(run => run.summary)};
  }
  resume(project: string, config: Config, adapter: Adapter, runId: string, sessionId: string) {
    return this.perform(async () => {
      if (this.active.has(project)) throw new LoopError('blocked', 'A verification loop is already running in this checkout');
      const store = await this.store(project, config, runId);
      if (digest(JSON.stringify(config)) !== digest(JSON.stringify(store.state.config))) {
        throw new LoopError('blocked', 'Plugin configuration changed; restore the original options to resume');
      }
      await prepareResume(store, adapter);
      store.state.originSessionId = sessionId;
      await store.save();
      return this.launch(store, adapter);
    });
  }
  stop(project: string, config: Config, adapter: Adapter, runId: string) {
    return this.perform(async () => {
      const task = this.active.get(project);
      if (task && task.store.state.runId === runId) {
        await atomicWrite(join(task.store.state.runDir, 'stop.request'), {time: Date.now()});
        task.abort.abort();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([task.promise, new Promise<void>(resolve => { timer = setTimeout(resolve, this.options.stopWaitMs ?? 2000); })]);
        clearTimeout(timer);
        return {...runSummary(task.store.state), ...(this.active.get(project) === task ? {outcome: 'stopping'} : {})};
      }
      const store = await this.store(project, config, runId);
      const pid = await store.ownerPid();
      if (pid !== null) {
        let alive = true;
        try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error; }
        if (alive) {
          await atomicWrite(join(store.state.runDir, 'stop.request'), {time: Date.now()});
          return {...runSummary(store.state), outcome: 'stopping'};
        }
      }
      const state = await stopRun(store, adapter);
      this.paused.delete(project);
      return runSummary(state);
    });
  }
  async wait(project: string) { await this.active.get(project)?.promise; }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const task of this.active.values()) task.abort.abort();
    this.closing = (async () => {
      await Promise.allSettled([...this.operations]);
      const tasks = [...this.active.values()];
      for (const task of tasks) task.abort.abort();
      await Promise.all(tasks.map(task => task.promise));
      for (const {state, adapter} of this.paused.values()) {
        try { await stopRun(new RunStore(state, this.options.lockRoot, this.runtimeId), adapter); }
        catch (error) {
          await new RunStore(state, this.options.lockRoot, this.runtimeId)
            .event('shutdown_reconciliation_failed', {reason: errorMessage(error)}).catch(() => {});
        }
      }
      this.paused.clear();
    })();
    return this.closing;
  }
}
