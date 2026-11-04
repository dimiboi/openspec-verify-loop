import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type AgentOptions = {phase?: string; label?: string};
export type LoopHost = {
  agent(prompt: string, opts?: AgentOptions): Promise<string>;
  phase(title: string): void;
  log(message: string): void;
  args: unknown;
  budget(): {maxAgentCalls: number};
};
export type LoopResult = {status: 'clean' | 'unverified' | 'blocked' | 'limit'; change: string | null; rounds: number; reason: string; report: string};

export const scriptPath = fileURLToPath(new URL('../skills/openspec-verify-loop/verify-loop.js', import.meta.url));
export const loadScript = () => readFile(scriptPath, 'utf8');

const META = 'export const meta =';
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
// Mirror the bb workflow sandbox: no clock, randomness, process or module access.
const math = Object.freeze(Object.fromEntries(Object.getOwnPropertyNames(Math)
  .filter(key => key !== 'random').map(key => [key, (Math as unknown as Record<string, unknown>)[key]])));

/** Run bb workflow source (literal meta, top-level await and return) with the given host functions. */
export function runScript(source: string, host: LoopHost): Promise<unknown> {
  if (!source.startsWith(META)) throw new Error('Workflow source must start with `export const meta =`');
  const body = `const meta =${source.slice(META.length)}`;
  const run = new AsyncFunction('agent', 'phase', 'log', 'args', 'budget', 'Date', 'Math', 'process', 'require', 'fetch', body);
  return run(host.agent, host.phase, host.log, host.args, host.budget, undefined, math, undefined, undefined, undefined);
}
