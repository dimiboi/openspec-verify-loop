import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const VERSION = '0.1.0';
export const OPENCODE_VERSION = '2.2.5';
export class LoopError extends Error {
  constructor(public outcome: string, message: string, public details?: unknown) { super(message); }
}
export function digest(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
export function contained(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
export async function exists(path: string) {
  try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
export type CommandResult = {command: string[]; workingDirectory: string; exitCode: number; stdout: string; stderr: string};
export async function command(argv: string[], cwd: string, timeout = 120_000, signal?: AbortSignal, envOverrides?: NodeJS.ProcessEnv): Promise<CommandResult> {
  if (!argv[0]) throw new Error('Empty command');
  if (signal?.aborted) throw signal.reason;
  const env = {...process.env,...envOverrides};
  // A check launched from a Node test harness must execute as an independent process.
  delete env.NODE_TEST_CONTEXT;
  return new Promise((res,rej)=>{
    const group = process.platform !== 'win32';
    const child = spawn(argv[0]!,argv.slice(1),{cwd,env,detached:group,stdio:['ignore','pipe','pipe']});
    const out: Buffer[] = [], err: Buffer[] = [];
    let bytes=0, stopped: Error | undefined, force: NodeJS.Timeout | undefined;
    const kill = (name: NodeJS.Signals) => {
      try {
        if(group && child.pid) process.kill(-child.pid,name);
        else if(child.pid) {
          // Windows has no POSIX process groups; terminate the command's tree.
          spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'}).on('error',()=>child.kill(name));
        }
      } catch(e) { if((e as NodeJS.ErrnoException).code!=='ESRCH') child.kill(name); }
    };
    const cancel = (reason: Error) => {
      if(stopped)return;
      stopped=reason;kill('SIGTERM');force=setTimeout(()=>kill('SIGKILL'),500);force.unref();
    };
    const abort = () => cancel(new Error('Command interrupted',{cause:signal?.reason}));
    const timer=setTimeout(()=>cancel(new Error(`Command timed out after ${timeout} ms: ${argv[0]}`)),timeout);
    const collect=(dest:Buffer[]) => (chunk:Buffer) => {
      bytes+=chunk.length;
      if(bytes>32*1024*1024)cancel(new Error(`Command output exceeded 32 MiB: ${argv[0]}`));
      else dest.push(chunk);
    };
    child.stdout.on('data',collect(out));child.stderr.on('data',collect(err));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    const cleanup=()=>{clearTimeout(timer);if(force)clearTimeout(force);signal?.removeEventListener('abort',abort);};
    child.on('error',e=>{cleanup();rej(new Error(`Cannot execute ${argv[0]}: ${e.message}`,{cause:e}));});
    child.on('close',(code,exitSignal)=>{
      if(stopped)kill('SIGKILL');cleanup();
      if(stopped)rej(stopped);
      else if(code===null)rej(new Error(`Command terminated by ${exitSignal}: ${argv[0]}`));
      else res({command:argv,workingDirectory:cwd,exitCode:code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});
    });
  });
}
export async function jsonCommand(argv: string[], cwd: string) {
  const r = await command(argv, cwd);
  if (r.exitCode !== 0) throw new LoopError('blocked', `${argv[0]} ${argv[1]} failed: ${r.stderr || r.stdout}`);
  try { return JSON.parse(r.stdout) as unknown; } catch { throw new Error(`Invalid JSON from ${argv[0]} ${argv[1]}`); }
}
export async function projectRoot(path: string) {
  const cwd = await realpath(resolve(path));
  const r = await command(['git', 'rev-parse', '--show-toplevel'], cwd);
  if (r.exitCode !== 0) throw new LoopError('blocked', 'The selected project must be a Git checkout');
  return realpath(r.stdout.trim());
}
export type Snapshot = {hash: string; files: Record<string, string>; head: string};
export async function snapshot(project: string): Promise<Snapshot> {
  const names = await command(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], project);
  if (names.exitCode) throw new Error('Cannot inventory checkout files');
  const files: Record<string, string> = {};
  for (const name of [...new Set(names.stdout.split('\0').filter(Boolean))].sort()) {
    const path = resolve(project, name);
    if (!contained(project, path)) throw new Error('Git returned a path outside the checkout');
    try {
      const st = await lstat(path);
      files[name] = st.isSymbolicLink() ? digest(`symlink:${await readlink(path)}`) :
        st.isDirectory() ? 'directory' : digest(Buffer.concat([Buffer.from(`${st.mode}:`), await readFile(path)]));
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; files[name] = 'deleted'; }
  }
  const head = await command(['git', 'rev-parse', '--verify', 'HEAD'], project);
  const headId = head.exitCode ? 'unborn' : head.stdout.trim();
  return {hash: digest(JSON.stringify({head: headId, files})), files, head: headId};
}
export function changedFiles(before: Snapshot, after: Snapshot) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(p => before.files[p] !== after.files[p]);
}
export function errorMessage(e: unknown) { return e instanceof Error ? e.message : String(e); }
export const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  if (signal?.aborted) { rej(signal.reason); return; }
  const abort = () => { clearTimeout(timer); rej(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); res(); }, ms);
  signal?.addEventListener('abort', abort, {once: true});
});
