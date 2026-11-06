import type { Assignment, Model, OpenCodeAdapter } from './opencode.js';
import type { AgentOptions } from './loop.js';
import { workerPermissions, type Role } from './workers.js';
import { delay, errorMessage, LoopError, newId } from './util.js';

export type WorkerCleanup = {sessionId: string; interrupt(): Promise<void>};
export type TrackWorker = (worker?: WorkerCleanup) => void;
export type RunnerOptions = {adapter: OpenCodeAdapter; project: string; directory?: string; runId: string; model: Model; signal: AbortSignal;
  pollMs?: number; trackWorker?: TrackWorker};

/** The workflow `agent()` for OpenCode: one fresh session per call, submitted at most once. */
export function createAgent(o: RunnerOptions) {
  let round = 0;
  return async (prompt: string, opts: AgentOptions = {}): Promise<string> => {
    o.signal.throwIfAborted();
    const role: Role = opts.phase === 'Verify' ? 'verifier' : 'fixer';
    if (role === 'verifier') round++;
    const a: Assignment = {sessionId: newId('ses'), inputId: newId('msg'), project: o.project, directory: o.directory, runId: o.runId,
      round, role, agent: 'build', model: o.model, permissions: workerPermissions(role), prompt};
    let inactive = false;
    let cleaning: Promise<void> | undefined;
    const clear = () => { inactive = true; o.trackWorker?.(); };
    const worker: WorkerCleanup = {sessionId: a.sessionId, interrupt: () => {
      if (inactive) return Promise.resolve();
      return cleaning ??= (async () => {
        try {
          if (!await o.adapter.interrupt(a)) throw new Error('interruption was not confirmed');
          clear();
        } catch (error) {
          throw new LoopError('failed', `Worker ${a.sessionId} cleanup failed: ${errorMessage(error)}. Checkout remains reserved; retry stop to clean up this worker.`);
        }
      })().finally(() => { cleaning = undefined; });
    }};
    o.trackWorker?.(worker);
    try {
      await o.adapter.ensureSession(a);
      o.signal.throwIfAborted();
      await o.adapter.ensurePrompt(a);
      while (true) {
        o.signal.throwIfAborted();
        const observation = await o.adapter.observe(a);
        if (observation.status === 'completed') clear();
        o.signal.throwIfAborted();
        if (observation.status === 'completed') return observation.text;
        if (observation.status === 'awaiting_input') {
          throw new LoopError('blocked', `The ${role} session ${a.sessionId} is waiting for input: ${JSON.stringify(observation.requests)}`);
        }
        if (observation.status !== 'running') throw new Error(`The ${role} session ${a.sessionId} ${observation.status}: ${observation.reason}`);
        await delay(o.pollMs ?? 2000, o.signal);
      }
    } catch (error) {
      try { await worker.interrupt(); }
      catch (cleanupError) { throw new LoopError('failed', `${errorMessage(error)}; ${errorMessage(cleanupError)}`); }
      throw o.signal.aborted ? o.signal.reason : error;
    }
  };
}
