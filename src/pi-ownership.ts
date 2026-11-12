import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson, readJson } from './pi-files.js';

const exec = promisify(execFile);
export type ProcessIdentity = {pid: number; start: string};

export async function processIdentity(pid: number): Promise<ProcessIdentity | undefined> {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid process identity');
  if (process.platform === 'win32') {
    const {stdout} = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToUniversalTime().Ticks }`], {timeout: 5000});
    return stdout.trim() ? {pid, start: stdout.trim()} : undefined;
  }
  try {
    const {stdout} = await exec('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'stat='],
      {timeout: 5000, env: {...process.env, TZ: 'UTC', LC_ALL: 'C'}});
    const line = stdout.trim();
    if (!line || /\sZ\S*$/.test(line)) return;
    return {pid, start: line.replace(/\s+\S+$/, '').trim()};
  } catch (error) {
    if ((error as {code?: unknown}).code === 1) return;
    throw error;
  }
}

type Owner = ProcessIdentity & {token: string};

/** Serialize lock-file changes as well as ownership; never steal a lock on a timer. */
async function guarded<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(directory, {recursive: true, mode: 0o700});
  const guard = join(directory, 'ownership.guard');
  try { await mkdir(guard, {mode: 0o700}); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(`Ownership change is in progress or uncertain: ${guard}. Retry; after a crash, confirm all owners are inactive before removing this guard.`);
  }
  try { return await operation(); }
  finally { await rm(guard, {recursive: true}); }
}

export async function acquireOwnership(directory: string) {
  const path = join(directory, 'owner.json');
  const identity = await processIdentity(process.pid);
  if (!identity) throw new Error('Cannot establish the Pi process identity');
  const owner: Owner = {...identity, token: randomUUID()};
  await guarded(directory, async () => {
    const previous = await readJson<Owner>(path);
    if (previous) {
      if (!previous.token || typeof previous.start !== 'string') throw new Error(`Uncertain owner record: ${path}`);
      const current = await processIdentity(previous.pid);
      if (current?.start === previous.start) throw new Error(`Checkout is owned by Pi process ${previous.pid}; use its loop controls`);
    }
    await atomicJson(path, owner);
  });
  return {
    owner,
    assert: async () => {
      if ((await readJson<Owner>(path))?.token !== owner.token) throw new Error('Pi checkout ownership was lost');
    },
    release: () => guarded(directory, async () => {
      if ((await readJson<Owner>(path))?.token !== owner.token) throw new Error('Cannot release another Pi owner');
      await rm(path);
    }),
  };
}

export async function hasLiveOwner(directory: string): Promise<boolean> {
  const owner = await readJson<Owner>(join(directory, 'owner.json'));
  return !!owner && (await processIdentity(owner.pid))?.start === owner.start;
}
