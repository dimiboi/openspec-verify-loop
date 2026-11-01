import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { appendFile, mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { contained, digest, exists, LoopError, VERSION, type Snapshot } from './util.js';
import type { Assignment } from './opencode.js';
import type { Config } from './config.js';
import type { Pins, Evidence } from './openspec.js';
import type { Finding, FixerReport, VerifierReport } from './reports.js';

export type Phase = 'preflight' | 'verifying' | 'fixing' | 'clean' | 'awaiting_input' | 'blocked' | 'failed' | 'interrupted' | 'limited';
export type Pending = {
  assignment: Assignment; stage: 'prepared' | 'created' | 'admitting' | 'submitted';
  before: Snapshot; evidence?: Evidence;
};
export type WorkerProgress = 'prepared' | 'submitted' | 'completed' | 'accepted';
export type Worker = {
  sessionId: string; inputId: string; role: 'verifier' | 'fixer'; round: number;
  /** Optional for runs saved before lifecycle reporting was introduced. */
  progress?: WorkerProgress;
};
export type FailureContext = {
  role: 'verifier' | 'fixer'; round: number; stage: string; error: string;
  sessionId?: string; inputId?: string; cleanupError?: string;
};
export type RunState = {
  schemaVersion: 2; pluginVersion: string; originSessionId?: string; runId: string; project: string; runDir: string;
  config: Config; pins: Pins; phase: Phase; nextRole: 'verifier' | 'fixer'; round: number;
  createdAt: number; updatedAt: number; activeMs: number; executor?: {pid: number; runtimeId: string};
  pending?: Pending; prior: Finding[]; verifier?: VerifierReport; fixer?: FixerReport;
  taskContext?: Evidence['apply'];
  stalledCycles: number; lastFixFingerprint?: string; lastFixWorkspace?: string;
  reason?: string; failure?: FailureContext; finalizationFailure?: FailureContext; requests?: unknown[]; initial: Snapshot;
  workers: Worker[];
};
export function defaultStateRoot() {
  if (process.env.XDG_STATE_HOME) return resolve(process.env.XDG_STATE_HOME, 'openspec-verify-loop');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'openspec-verify-loop');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? homedir(), 'openspec-verify-loop');
  return join(homedir(), '.local/state/openspec-verify-loop');
}
export const projectKey = (project: string) => digest(project).slice(0, 24);
export const projectRunsDirectory = (root: string, project: string) => join(resolve(root), 'runs', projectKey(project));
export function newId(prefix: string) { return `${prefix}_${Date.now().toString(16)}${randomUUID().replaceAll('-', '')}`; }
export async function atomicWrite(path: string, value: unknown, raw = false) {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, raw ? String(value) : `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600, flag: 'wx'});
    await rename(temp, path);
  } finally { await rm(temp, {force: true}); }
}
export function runDirectory(root: string, project: string, runId: string) {
  if (!/^run_[a-f0-9]+$/.test(runId)) throw new Error('Invalid run ID');
  return join(projectRunsDirectory(root, project), runId);
}
export async function ensureExternalState(root: string, project: string, packageDir?: string) {
  const requested = resolve(root);
  let ancestor = requested;
  while (!await exists(ancestor)) ancestor = dirname(ancestor);
  const canonical = resolve(await realpath(ancestor),relative(ancestor,requested));
  if (contained(await realpath(project), canonical) || (packageDir && contained(await realpath(packageDir), canonical))) {
    throw new Error('Run state must be outside the checkout and installed plugin');
  }
  await mkdir(canonical, {recursive: true, mode: 0o700});
  return canonical;
}
const lockSchema = z.object({runId: z.string(), runDir: z.string(), pid: z.number().int().nullable(), runtimeId: z.string(), token: z.string()});
type Lock = z.infer<typeof lockSchema>;
export type ReservationIdentity = Pick<Lock, 'runId' | 'runDir' | 'runtimeId' | 'token'>;
const matchesReservation = (owner: Lock, expected: ReservationIdentity) => owner.runId === expected.runId &&
  owner.runDir === expected.runDir && owner.runtimeId === expected.runtimeId && owner.token === expected.token;
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

export class RunStore {
  readonly lockDir: string;
  private token = randomUUID();
  private owns = false;
  constructor(public state: RunState, lockRoot = join(defaultStateRoot(), 'locks'), readonly runtimeId: string = randomUUID()) {
    this.lockDir = join(lockRoot, projectKey(state.project));
  }
  get reservationIdentity(): ReservationIdentity {
    return {runId:this.state.runId,runDir:this.state.runDir,runtimeId:this.runtimeId,token:this.token};
  }
  private async readOwner(): Promise<Lock> {
    return lockSchema.parse(JSON.parse(await readFile(join(this.lockDir,'owner.json'),'utf8')));
  }
  async acquire(resume = false, expected?: ReservationIdentity): Promise<boolean> {
    await mkdir(dirname(this.lockDir), {recursive: true, mode: 0o700});
    let existing = Boolean(expected), claimed = false;
    if (!expected) {
      try { await mkdir(this.lockDir, {mode: 0o700}); }
      catch (e) {if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; existing = true;}
    }
    const ownerPath = join(this.lockDir,'owner.json');
    let recoveryPath: string | undefined;
    try {
      if (existing) {
        let lock: Lock;
        try { lock = await this.readOwner(); }
        catch (error) {
          if (expected && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw new LoopError('blocked', `Incomplete checkout lock at ${this.lockDir}; inspect it before recovery`);
        }
        if (expected && !matchesReservation(lock,expected)) return false;
        if (!resume || lock.runId !== this.state.runId || lock.runDir !== this.state.runDir) {
          throw new LoopError('blocked', `Checkout reserved by ${lock.runId}; explicitly resume or stop it`, {runDir: lock.runDir});
        }
        if (lock.pid !== null && alive(lock.pid)) throw new LoopError('blocked', `Controller ${lock.pid} is still running`);
        recoveryPath = join(this.lockDir,`recovery-${digest(lock.token)}`);
        // Revalidate under the exclusive claim: a waiter may have read the old
        // owner before another recovery published a live replacement.
        try { await writeFile(recoveryPath, this.token, {flag: 'wx', mode: 0o600}); claimed = true; }
        catch { throw new LoopError('blocked', `Another recovery owns ${this.lockDir}`); }
        const current = await this.readOwner();
        if (!matchesReservation(current,lock) || current.pid !== lock.pid) {
          if (expected) return false;
          throw new LoopError('blocked','Checkout reservation changed during recovery');
        }
        if (current.pid !== null && alive(current.pid)) throw new LoopError('blocked', `Controller ${current.pid} is still running`);
      }
      this.owns = true;
      await atomicWrite(ownerPath, {runId: this.state.runId, runDir: this.state.runDir, pid: process.pid, runtimeId: this.runtimeId, token: this.token});
      // A caller may have loaded this run before another controller advanced or
      // completed it. Refresh under the new lease before any saved-state write.
      if (resume) this.state = await loadRun(this.state.runDir,this.state.project);
      this.state.executor = {pid: process.pid, runtimeId: this.runtimeId};
      await this.save();
      return true;
    } finally {
      if (claimed && recoveryPath) {
        try {if (await readFile(recoveryPath,'utf8') === this.token) await rm(recoveryPath,{force:true});}
        catch { /* Never remove a recovery claim whose ownership is uncertain. */ }
      }
    }
  }
  async ownerPid(): Promise<number | null> {
    const path=join(this.lockDir,'owner.json');
    try {
      const owner=lockSchema.parse(JSON.parse(await readFile(path,'utf8')));
      return owner.runId===this.state.runId && owner.runDir===this.state.runDir ? owner.pid : null;
    } catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  }
  /** A cached lease is insufficient after an uncertain release or handoff. */
  async hasLiveOwnership(): Promise<boolean> {
    if (!this.owns) return false;
    try {
      const owner = lockSchema.parse(JSON.parse(await readFile(join(this.lockDir,'owner.json'),'utf8')));
      return owner.token === this.token && owner.runtimeId === this.runtimeId && owner.pid === process.pid &&
        owner.runId === this.state.runId && owner.runDir === this.state.runDir;
    } catch { return false; }
  }
  async save() {
    this.state.updatedAt = Date.now();
    await atomicWrite(join(this.state.runDir, 'state.json'), this.state);
  }
  async event(type: string, data: unknown = {}) {
    await mkdir(this.state.runDir, {recursive: true, mode: 0o700});
    await appendFile(join(this.state.runDir, 'events.jsonl'), `${JSON.stringify({time: Date.now(), type, data})}\n`, {mode: 0o600});
  }
  async release(retainReservation: boolean) {
    if (!this.owns) return;
    const path = join(this.lockDir, 'owner.json');
    const owner = lockSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (owner.token !== this.token) throw new Error('Checkout lock ownership changed');
    delete this.state.executor;
    await this.save();
    if (retainReservation) await atomicWrite(path, {...owner, pid: null});
    else await rm(this.lockDir, {recursive: true});
    this.owns = false;
  }
  async stopping() { return exists(join(this.state.runDir, 'stop.request')); }
}

export async function loadRun(runDir: string, project: string): Promise<RunState> {
  const value = JSON.parse(await readFile(join(runDir, 'state.json'), 'utf8')) as RunState;
  if (value.schemaVersion !== 2 || value.pluginVersion !== VERSION || value.project !== project || value.runDir !== runDir ||
      value.pins?.project !== project || !Number.isInteger(value.round) || value.round < 1 || !Array.isArray(value.prior)) {
    throw new Error('Incompatible or invalid saved run state');
  }
  return value;
}
