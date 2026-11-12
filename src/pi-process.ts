import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Context } from '@earendil-works/chord/context';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { err, ExecutionError, type ShellExecOptions } from '@earendil-works/pi-durable/env';
import { atomicJson, readJson } from './pi-files.js';
import { processIdentity } from './pi-ownership.js';
import type { CommandReceipt } from './pi-supervisor.js';

const exec = promisify(execFile);
const supervisor = fileURLToPath(new URL('../dist/pi-supervisor.js', import.meta.url));

async function activeGroup(pid: number): Promise<boolean> {
  if (process.platform === 'win32') return !!await processIdentity(pid);
  const {stdout} = await exec('ps', ['-ax', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat='], {timeout: 5000});
  return stdout.split('\n').some(line => {
    const fields = line.trim().split(/\s+/);
    return Number(fields[1]) === pid && !fields[2]?.startsWith('Z');
  });
}

async function cleanReceipt(path: string, stop: boolean) {
  const receipt = await readJson<CommandReceipt>(path);
  if (!receipt || receipt.state === 'done') return;
  if (!receipt.process) throw new Error(`Command admission is uncertain; confirm no command started before marking this receipt done: ${path}`);
  const identity = await processIdentity(receipt.process.pid);
  if (identity && identity.start !== receipt.process.start) throw new Error(`Command PID was reused; cleanup is uncertain: ${path}`);
  if (await activeGroup(receipt.process.pid)) {
    if (!stop) throw new Error(`Previous command ${receipt.process.pid} is still active; stop the run before resuming: ${path}`);
    if (process.platform === 'win32') await exec('taskkill.exe', ['/F', '/T', '/PID', String(receipt.process.pid)], {timeout: 5000});
    else { try { process.kill(-receipt.process.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
    for (let i = 0; i < 50 && await activeGroup(receipt.process.pid); i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (await activeGroup(receipt.process.pid)) throw new Error(`Command ${receipt.process.pid} cleanup unconfirmed: ${path}`);
  }
  await atomicJson(path, {...receipt, state: 'done'});
}

export async function reconcileCommands(directory: string, stop: boolean): Promise<void> {
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const name of files.filter(name => name.endsWith('.json'))) await cleanReceipt(join(directory, name), stop);
}

export class SupervisedEnv extends NodeExecutionEnv {
  constructor(cwd: string, private receipts: string) { super({cwd}); }
  override async exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context): ReturnType<NodeExecutionEnv['exec']> {
    if (context.abortSignal?.aborted) return err(new ExecutionError('aborted', 'aborted'));
    const path = join(this.receipts, `${randomUUID()}.json`);
    await atomicJson(path, {token: randomUUID(), parent: process.pid, state: 'planned', process: null} satisfies CommandReceipt);
    const result = await super.exec([process.execPath, supervisor, path, JSON.stringify(command)], options, context);
    await cleanReceipt(path, true);
    return result;
  }
}
