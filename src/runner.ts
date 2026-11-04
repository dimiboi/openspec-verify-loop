import type { Adapter, Assignment, Model } from './opencode.js';
import type { AgentOptions } from './loop.js';
import { workerPermissions, type Role } from './workers.js';
import { delay, LoopError, newId } from './util.js';

export type RunnerOptions = {adapter: Adapter; project: string; runId: string; model: Model; signal: AbortSignal; pollMs?: number};

/** The workflow `agent()` for OpenCode: one fresh session per call, submitted at most once. */
export function createAgent(o: RunnerOptions) {
  let round = 0;
  return async (prompt: string, opts: AgentOptions = {}): Promise<string> => {
    o.signal.throwIfAborted();
    const role: Role = opts.phase === 'Verify' ? 'verifier' : 'fixer';
    if (role === 'verifier') round++;
    const a: Assignment = {sessionId: newId('ses'), inputId: newId('msg'), project: o.project, runId: o.runId,
      round, role, agent: 'build', model: o.model, permissions: workerPermissions(role), prompt};
    await o.adapter.ensureSession(a);
    try {
      // OpenCode 2.2.5 can restart a finished session for a duplicate input: reconcile, never resubmit.
      try { await o.adapter.ensurePrompt(a, true); } catch { await o.adapter.ensurePrompt(a, false); }
      while (true) {
        o.signal.throwIfAborted();
        const observation = await o.adapter.observe(a);
        if (observation.status === 'completed') return observation.text;
        if (observation.status === 'awaiting_input') {
          await o.adapter.interrupt(a).catch(() => false);
          throw new LoopError('blocked', `The ${role} session ${a.sessionId} is waiting for input: ${JSON.stringify(observation.requests)}`);
        }
        if (observation.status !== 'running') throw new Error(`The ${role} session ${a.sessionId} ${observation.status}: ${observation.reason}`);
        await delay(o.pollMs ?? 2000, o.signal);
      }
    } catch (error) {
      if (!o.signal.aborted) throw error;
      await o.adapter.interrupt(a).catch(() => false);
      throw o.signal.reason;
    }
  };
}
