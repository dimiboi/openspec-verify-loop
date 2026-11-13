import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

export const OPENCODE_VERSION = '2.2.5';
export const PI_VERSION = '1.5.2';
// Pre-release suffixes are ignored; a version that does not parse counts as older.
export function requirePi(found: string) {
  const parts = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const have = parts(found), want = parts(PI_VERSION)!;
  const cmp = have ? have.map((n, i) => n - want[i]!).find(d => d !== 0) ?? 0 : -1;
  if (cmp < 0) throw new Error(`Pi loop requires Pi ${PI_VERSION} or later; found ${found}`);
}
export class LoopError extends Error {
  constructor(public outcome: string, message: string) { super(message); }
}
export function newId(prefix: string) { return `${prefix}_${Date.now().toString(16)}${randomUUID().replaceAll('-', '')}`; }
export function sessionDirectory(session: {location: {directory: string}; subpath?: string}, checkoutRoot: string) {
  // OpenCode's subpath is relative to the Git root, even when location.directory is already nested.
  return resolve(session.subpath ? checkoutRoot : session.location.directory, session.subpath ?? '.');
}
export async function projectRoot(path: string) {
  const cwd = await realpath(resolve(path));
  const {stdout} = await promisify(execFile)('git', ['rev-parse', '--show-toplevel'], {cwd, timeout: 120_000}).catch(e => {
    // A nonzero exit means "not a checkout"; spawn failures and timeouts keep their own error.
    throw typeof e.code === 'number' ? new LoopError('blocked', 'The selected project must be a Git checkout') : e;
  });
  return realpath(stdout.trim());
}
export function errorMessage(e: unknown) { return e instanceof Error ? e.message : String(e); }
export const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  if (signal?.aborted) { rej(signal.reason); return; }
  const abort = () => { clearTimeout(timer); rej(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); res(); }, ms);
  signal?.addEventListener('abort', abort, {once: true});
});
