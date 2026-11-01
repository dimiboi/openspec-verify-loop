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
export type RunState = {
  schemaVersion: 1; controllerVersion: string; runId: string; project: string; runDir: string;
  config: Config; pins: Pins; phase: Phase; nextRole: 'verifier' | 'fixer'; round: number;
  createdAt: number; updatedAt: number; activeMs: number; controllerPid?: number;
  pending?: Pending; prior: Finding[]; verifier?: VerifierReport; fixer?: FixerReport;
  taskContext?: Evidence['apply'];
  stalledCycles: number; lastFixFingerprint?: string; lastFixWorkspace?: string;
  reason?: string; requests?: unknown[]; initial: Snapshot;
  workers: {sessionId: string; inputId: string; role: 'verifier' | 'fixer'; round: number}[];
};
export function defaultStateRoot() {
  if (process.env.XDG_STATE_HOME) return resolve(process.env.XDG_STATE_HOME, 'openspec-verify-loop');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'openspec-verify-loop');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? homedir(), 'openspec-verify-loop');
  return join(homedir(), '.local/state/openspec-verify-loop');
}
export const projectKey = (project: string) => digest(project).slice(0, 24);
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
  return join(resolve(root), projectKey(project), runId);
}
export async function ensureExternalState(root: string, project: string, skillDir?: string) {
  const requested = resolve(root);
  let ancestor = requested;
  while (!await exists(ancestor)) ancestor = dirname(ancestor);
  const canonical = resolve(await realpath(ancestor),relative(ancestor,requested));
  if (contained(await realpath(project), canonical) || (skillDir && contained(await realpath(skillDir), canonical))) {
    throw new Error('Run state must be outside the checkout and installed skill');
  }
  await mkdir(canonical, {recursive: true, mode: 0o700});
  return canonical;
}
const lockSchema = z.object({runId: z.string(), runDir: z.string(), pid: z.number().int().nullable(), token: z.string()});
type Lock = z.infer<typeof lockSchema>;
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

export class RunStore {
  readonly lockDir: string;
  private token = randomUUID();
  private owns = false;
  constructor(public state: RunState, lockRoot = join(defaultStateRoot(), 'locks')) {
    this.lockDir = join(lockRoot, projectKey(state.project));
  }
  async acquire(resume = false) {
    await mkdir(dirname(this.lockDir), {recursive: true, mode: 0o700});
    try { await mkdir(this.lockDir, {mode: 0o700}); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let lock: Lock;
      try { lock = lockSchema.parse(JSON.parse(await readFile(join(this.lockDir, 'owner.json'), 'utf8'))); }
      catch { throw new LoopError('blocked', `Incomplete checkout lock at ${this.lockDir}; inspect it before recovery`); }
      if (!resume || lock.runId !== this.state.runId || lock.runDir !== this.state.runDir) {
        throw new LoopError('blocked', `Checkout reserved by ${lock.runId}; explicitly resume or stop it`, {runDir: lock.runDir});
      }
      if (lock.pid !== null && alive(lock.pid)) throw new LoopError('blocked', `Controller ${lock.pid} is still running`);
      // Exclusive recovery lease prevents two simultaneous resumptions of a dead controller.
      try { await writeFile(join(this.lockDir, 'recovery'), this.token, {flag: 'wx', mode: 0o600}); }
      catch { throw new LoopError('blocked', `Another recovery owns ${this.lockDir}`); }
    }
    this.owns = true;
    await atomicWrite(join(this.lockDir, 'owner.json'), {runId: this.state.runId, runDir: this.state.runDir, pid: process.pid, token: this.token});
    await rm(join(this.lockDir, 'recovery'), {force: true});
    this.state.controllerPid = process.pid;
    await this.save();
  }
  async ownerPid(): Promise<number | null> {
    const path=join(this.lockDir,'owner.json');
    try {
      const owner=lockSchema.parse(JSON.parse(await readFile(path,'utf8')));
      return owner.runId===this.state.runId && owner.runDir===this.state.runDir ? owner.pid : null;
    } catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
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
    delete this.state.controllerPid;
    await this.save();
    if (retainReservation) await atomicWrite(path, {...owner, pid: null});
    else await rm(this.lockDir, {recursive: true});
    this.owns = false;
  }
  async stopping() { return exists(join(this.state.runDir, 'stop.request')); }
}

export async function loadRun(runDir: string, project: string): Promise<RunState> {
  const value = JSON.parse(await readFile(join(runDir, 'state.json'), 'utf8')) as RunState;
  if (value.schemaVersion !== 1 || value.controllerVersion !== VERSION || value.project !== project || value.runDir !== runDir ||
      value.pins?.project !== project || !Number.isInteger(value.round) || value.round < 1 || !Array.isArray(value.prior)) {
    throw new Error('Incompatible or invalid saved run state');
  }
  return value;
}
