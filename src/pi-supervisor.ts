import { spawn, spawnSync } from 'node:child_process';
import { atomicJson, readJson } from './pi-files.js';
import { processIdentity } from './pi-ownership.js';

export type CommandReceipt = {
  token: string; parent: number; state: 'planned' | 'running' | 'done';
  process: {pid: number; start: string} | null;
};

// NodeExecutionEnv starts this wrapper as a process-group leader on POSIX.
async function main() {
  const [receiptPath, commandJson] = process.argv.slice(2);
  if (!receiptPath || !commandJson) throw new Error('Missing supervisor arguments');
  const receipt = await readJson<CommandReceipt>(receiptPath);
  if (!receipt || receipt.state !== 'planned') throw new Error('Missing command intent');
  if (process.ppid !== receipt.parent) throw new Error('The command owner exited before dispatch');
  const identity = await processIdentity(process.pid);
  if (!identity) throw new Error('Cannot establish command process identity');
  await atomicJson(receiptPath, {...receipt, state: 'running', process: identity});
  if (process.ppid !== receipt.parent) return terminate();
  const command: string | string[] = JSON.parse(commandJson);
  const child = typeof command === 'string'
    ? spawn(process.platform === 'win32' ? 'bash.exe' : 'bash', ['-c', command], {stdio: 'inherit'})
    : spawn(command[0]!, command.slice(1), {stdio: 'inherit'});
  const watchdog = setInterval(() => { if (process.ppid !== receipt.parent) terminate(); }, 100);
  child.on('error', error => { console.error(error.message); process.exitCode = 1; clearInterval(watchdog); });
  child.on('exit', (code, signal) => {
    clearInterval(watchdog);
    process.exitCode = signal ? 1 : code ?? 1;
  });
}

function terminate(): never {
  if (process.platform !== 'win32') process.kill(-process.pid, 'SIGKILL');
  else spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(process.pid)], {stdio: 'ignore', windowsHide: true});
  process.exit(1);
}

void main().catch(error => { console.error(error.message); process.exitCode = 1; });
