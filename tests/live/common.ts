import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const change = 'add-greeting';
export type Host = 'bb' | 'opencode' | 'pi';
export type Options = {
  host: Host; scenario: 'fix-to-clean' | 'stop' | 'resume'; provider: string; model: string;
  procedure: string; variant: string; mode?: string; reasoning?: string;
  timeout: number; cleanupTimeout: number; output: string; providerExtension?: string;
};
export const help = (host: Host) => `Live ${host} checks (explicit model calls; one attempt per invocation)
--scenario fix-to-clean|stop${host === 'pi' ? '|resume' : ''} --provider ID --model ID --procedure /path/to/SKILL.md
${host === 'bb' ? '--permission-mode auto|full [--reasoning-level medium]' : host === 'pi' ? '[--reasoning-level medium] [--provider-extension /path/to/provider]' : '[--variant default]'}
[--timeout 3600] [--cleanup-timeout 60] [--output /path/outside/source]
Timeouts are seconds. Evidence, fixtures and host sessions are retained.
${host === 'pi' ? 'Pi uses isolated fixture state; provide credentials in the environment or a provider extension.' : 'Install the tested checkout explicitly on bb; OpenCode uses an existing 2.2.5 service.'}
`;

export function options(host: Host, args: string[]): Options | undefined {
  const {values} = parseArgs({args, options: {
    help: {type: 'boolean'}, scenario: {type: 'string'}, provider: {type: 'string'}, model: {type: 'string'}, 'provider-extension': {type: 'string'},
    procedure: {type: 'string'}, variant: {type: 'string'}, 'permission-mode': {type: 'string'},
    'reasoning-level': {type: 'string'}, timeout: {type: 'string'}, 'cleanup-timeout': {type: 'string'}, output: {type: 'string'},
  }});
  if (values.help) return;
  assert(values.scenario === 'fix-to-clean' || values.scenario === 'stop' || (host === 'pi' && values.scenario === 'resume'), '--scenario must be fix-to-clean or stop (Pi also supports resume)');
  for (const key of ['provider', 'model', 'procedure'] as const) assert(values[key]?.trim(), `--${key} is required`);
  if (host === 'bb') {
    assert(['auto', 'full'].includes(values['permission-mode'] ?? ''), '--permission-mode must be auto or full');
    if (values.provider!.startsWith('acp-')) assert.equal(values['permission-mode'], 'full', 'ACP requires full mode');
    assert(!values.variant, '--variant is only supported by OpenCode');
  } else if (host === 'pi') {
    assert(!values['permission-mode'] && !values.variant, 'Pi does not accept permission-mode or variant');
    if (values['reasoning-level']) assert(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(values['reasoning-level']), 'Invalid Pi reasoning level');
  } else assert(!values['permission-mode'] && !values['reasoning-level'], 'bb settings cannot be used on OpenCode');
  if (host !== 'pi') assert(!values['provider-extension'], '--provider-extension is only supported by Pi');
  const seconds = (value: string, name: string) => {
    const n = Number(value);
    assert(Number.isFinite(n) && n > 0 && n * 1000 <= 2 ** 31 - 1, `${name} must be finite positive seconds`);
    return n * 1000;
  };
  return {host, scenario: values.scenario, provider: values.provider!, model: values.model!,
    procedure: resolve(values.procedure!), variant: values.variant ?? 'default', mode: values['permission-mode'],
    reasoning: values['reasoning-level'], timeout: seconds(values.timeout ?? '3600', '--timeout'),
    cleanupTimeout: seconds(values['cleanup-timeout'] ?? '60', '--cleanup-timeout'), output: resolve(values.output ?? tmpdir()),
    ...(values['provider-extension'] ? {providerExtension: resolve(values['provider-extension'])} : {})};
}

export type CommandResult = {code: number; stdout: string; stderr: string};
export type Command = (file: string, args: string[], opts?: {cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal}) => Promise<CommandResult>;
export const command: Command = async (file, args, opts = {}) => {
  const env = {...process.env, ...opts.env};
  // A nested Node test process must discover its own fixture tests.
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await promisify(execFile)(file, args, {...opts, env, cwd: opts.cwd ?? repository,
      timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024});
    return {code: 0, ...result};
  } catch (error) {
    const e = error as Error & {code?: unknown; stdout?: string; stderr?: string; killed?: boolean};
    if (typeof e.code !== 'number' || e.killed || opts.signal?.aborted) throw error;
    return {code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? ''};
  }
};
export async function checked(file: string, args: string[], opts?: Parameters<Command>[2], run = command) {
  const result = await run(file, args, opts);
  assert.equal(result.code, 0, `${file} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export const exists = async (path: string) => {
  try { await stat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
};
export const inside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
export async function hashes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(dir: string) {
    for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      assert(!entry.isSymbolicLink(), `Snapshot resources must be ordinary files: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await visit(root);
  return result;
}

export type Check = {name: string; passed: boolean; detail?: unknown};
export type Worker = {id: string; role: 'verifier' | 'fixer'; start: number; end?: number; settings: unknown; active: boolean};
export type Result = {
  host: Host; scenario: Options['scenario']; status: 'running' | 'passed' | 'failed' | 'not_exercised';
  stage: string; startedAt: string; finishedAt?: string; settings: Options;
  assertions: Check[]; errors: string[]; missingEvidence: string[];
  cleanup: {confirmed: boolean; fallback: boolean; detail?: unknown};
  originId?: string; projectId?: string; runId?: string; terminal?: Record<string, unknown>;
  workers: Worker[]; [key: string]: unknown;
};

// Never persist service credentials, even if a host adds them to a response.
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) =>
    [key, /^(authorization|headers|serverHeaders|token|apiKey|credentials)$/i.test(key) ? '[redacted]' : redact(v)]));
  return value;
}
export class Attempt {
  readonly fixture: string;
  readonly evidence: string;
  readonly result: Result;
  private constructor(readonly root: string, readonly options: Options) {
    this.fixture = join(root, 'fixture'); this.evidence = join(root, 'evidence');
    this.result = {host: options.host, scenario: options.scenario, status: 'running', stage: 'setup',
      startedAt: new Date().toISOString(), settings: options, assertions: [], errors: [], missingEvidence: [],
      cleanup: {confirmed: false, fallback: false}, workers: []};
  }
  static async create(options: Options) {
    await mkdir(options.output, {recursive: true});
    const output = await realpath(options.output);
    assert(!inside(await realpath(repository), output), 'Live output must be outside the plugin source checkout');
    const root = await mkdtemp(join(output, `loop-live-${options.host}-`));
    const attempt = new Attempt(root, options);
    await mkdir(attempt.evidence);
    await attempt.save();
    return attempt;
  }
  async record(name: string, value: unknown) {
    assert(/^[a-zA-Z0-9_.-]+$/.test(name), 'Evidence name must be a filename');
    await appendFile(join(this.evidence, `${name}.jsonl`), JSON.stringify(redact(value)) + '\n');
  }
  check(name: string, passed: boolean, detail?: unknown) {
    this.result.assertions.push({name, passed, detail});
    return passed;
  }
  async save() {
    await writeFile(join(this.evidence, 'result.json'), JSON.stringify(redact(this.result), null, 2) + '\n');
    const r = this.result;
    await writeFile(join(this.evidence, 'summary.md'), `# Live ${r.host}: ${r.scenario}\n\n` +
      `Status: **${r.status}**. Stage: ${r.stage}. Cleanup confirmed: ${r.cleanup.confirmed}.\n\n` +
      `Model: ${r.settings.provider}/${r.settings.model}. Run: ${r.runId ?? 'unknown'}. Origin: ${r.originId ?? 'none'}.\n\n` +
      `Retained fixture: ${this.fixture}\n\n[Complete result](result.json). Raw host records are adjacent JSONL files.\n\n` +
      r.assertions.map(c => `- [${c.passed ? 'x' : ' '}] ${c.name}`).join('\n') + '\n\n' +
      [...r.errors, ...r.missingEvidence].map(e => `- ${e}`).join('\n') + '\n');
  }
}

export async function prepareFixture(attempt: Attempt, run = command) {
  const source = await realpath(attempt.options.procedure);
  assert.equal(source.split(sep).at(-1), 'SKILL.md', '--procedure must name an installed SKILL.md');
  const content = await readFile(source, 'utf8');
  assert(/^name:\s*openspec-verify-change\s*$/m.test(content), 'Expected the installed openspec-verify-change procedure');
  const skillRoot = join(attempt.fixture, attempt.options.host === 'bb' ? '.bb/skills' : '.agents/skills', 'openspec-verify-change');
  await cp(fileURLToPath(new URL('./fixtures/greeting/', import.meta.url)), attempt.fixture, {recursive: true});
  const originalHashes = await hashes(dirname(source));
  await cp(dirname(source), skillRoot, {recursive: true});
  assert.deepEqual(await hashes(skillRoot), originalHashes, 'Procedure changed while copying');
  attempt.result.procedure = {source, path: join(skillRoot, 'SKILL.md'), hashes: originalHashes};
  await checked('git', ['init', '--initial-branch=main'], {cwd: attempt.fixture}, run);
  await checked('git', ['add', '.'], {cwd: attempt.fixture}, run);
  await checked('git', ['-c', 'user.name=Live test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Initial greeting'], {cwd: attempt.fixture}, run);
  const baseline = await run(process.execPath, ['--test'], {cwd: attempt.fixture});
  await attempt.record('baseline', baseline);
  assert.equal(baseline.code, 1, 'The seed must fail its greeting test');
  assert.match(baseline.stdout + baseline.stderr, /Hello Ada\./, 'Baseline must fail for the intended greeting defect');
  assert(!await exists(join(attempt.fixture, 'openspec/changes', change, 'design.md')));
  attempt.result.fixture = {path: attempt.fixture, revision: (await checked('git', ['rev-parse', 'HEAD'], {cwd: attempt.fixture}, run)).trim(), baseline};
  await attempt.save();
  return join(skillRoot, 'SKILL.md');
}

export async function independentChecks(attempt: Attempt, signal?: AbortSignal, run = command) {
  const script = join(attempt.root, 'assert-greeting.mjs');
  await writeFile(script, `import assert from 'node:assert/strict';\nimport {greet} from ${JSON.stringify(pathToFileURL(join(attempt.fixture, 'greet.mjs')).href)};\n` +
    `assert.equal(greet('Ada'), 'Hello, Ada!');\nassert.equal(greet(''), 'Hello, world!');\nassert.equal(greet(), 'Hello, world!');\n`);
  const checks = [
    ['Independent greeting behavior', await run(process.execPath, [script], {cwd: attempt.root, signal})],
    ['Fixture tests', await run(process.execPath, ['--test'], {cwd: attempt.fixture, signal})],
  ] as const;
  for (const [name, result] of checks) { attempt.check(name, result.code === 0); await attempt.record('checks', {name, ...result}); }
  attempt.check('Optional design remains absent', !await exists(join(attempt.fixture, 'openspec/changes', change, 'design.md')));
}

export async function collectPages<T, C extends string | number>(fetch: (cursor?: C) => Promise<{items: T[]; next?: C | null}>, signal?: AbortSignal) {
  const items: T[] = []; const seen = new Set<C>(); let cursor: C | undefined;
  do {
    signal?.throwIfAborted();
    const page = await fetch(cursor);
    assert(Array.isArray(page.items), 'Missing page data; collection incomplete');
    items.push(...page.items);
    assert(items.length <= 100_000, 'Collection exceeded 100000 records; evidence incomplete');
    const next = page.next ?? undefined;
    if (next !== undefined) { assert(!seen.has(next), 'Nonadvancing page cursor; evidence incomplete'); seen.add(next); }
    cursor = next;
  } while (cursor !== undefined);
  return items;
}
type NoticeInput = {id: string; type: string; text?: string; metadata?: Record<string, unknown>;
  payload?: unknown};
export function notices(messages: NoticeInput[], inbox: NoticeInput[]) {
  const found = new Map<string, {id: string; value: Record<string, unknown>; queued: boolean}>();
  for (const [records, queued] of [[inbox, true], [messages, false]] as const) for (const record of records) {
    const payload = (queued ? record.payload : record) as {text?: string; metadata?: Record<string, unknown>} | undefined;
    if (record.type !== 'synthetic' || payload?.metadata?.openspecLoopNotice !== true) continue;
    assert(typeof payload.text === 'string', 'Notice text missing; evidence incomplete');
    const start = payload.text.indexOf('\n');
    assert(start >= 0, 'Notice JSON missing; evidence incomplete');
    const value: unknown = JSON.parse(payload.text.slice(start + 1));
    assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid notice payload');
    found.set(record.id, {id: record.id, value: value as Record<string, unknown>, queued});
  }
  return [...found.values()];
}
export const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
  signal.addEventListener('abort', abort, {once: true});
});
export function checkWorkers(attempt: Attempt, expectedSettings: unknown) {
  const workers = attempt.result.workers;
  attempt.check('Fresh worker identities', workers.length > 0 && new Set(workers.map(w => w.id)).size === workers.length);
  attempt.check('Workers inherit settings', workers.length > 0 && workers.every(w => JSON.stringify(w.settings) === JSON.stringify(expectedSettings)));
  attempt.check('Sequential verifier/fixer workers', workers.length > 0 && workers[0]!.role === 'verifier' && workers.every((w, i) =>
    (i === 0 || (workers[i - 1]!.end !== undefined && workers[i - 1]!.end! <= w.start)) && w.role === (i % 2 ? 'fixer' : 'verifier')));
  if (attempt.options.scenario === 'fix-to-clean') {
    attempt.check('Fix followed by fresh verification', workers.some(w => w.role === 'fixer') && workers.at(-1)?.role === 'verifier');
    attempt.check('Loop ended clean', attempt.result.terminal?.status === 'clean', attempt.result.terminal);
  }
}

export async function lifecycle(attempt: Attempt, execute: (signal: AbortSignal) => Promise<void>, cleanup: (signal: AbortSignal) => Promise<void>) {
  const interrupt = new AbortController();
  const onInterrupt = () => interrupt.abort(new Error('Process interrupted'));
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onInterrupt);
  const signal = AbortSignal.any([interrupt.signal, AbortSignal.timeout(attempt.options.timeout)]);
  try {
    await execute(signal);
    if (attempt.result.status !== 'not_exercised') attempt.result.status = attempt.result.assertions.length > 0 && attempt.result.assertions.every(c => c.passed) ? 'passed' : 'failed';
  } catch (e) { attempt.result.errors.push(String(e)); attempt.result.status = 'failed'; }
  finally {
    const originalStage = attempt.result.stage;
    try {
      await cleanup(AbortSignal.timeout(attempt.options.cleanupTimeout));
      assert(attempt.result.cleanup.confirmed, 'Cleanup did not confirm inactivity');
    } catch (e) {
      attempt.result.errors.push(`Cleanup: ${e}`); attempt.result.stage = 'cleanup'; attempt.result.status = 'failed';
    }
    if (attempt.result.status === 'passed') attempt.result.stage = 'complete';
    else if (attempt.result.stage !== 'cleanup') attempt.result.stage = originalStage;
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onInterrupt);
    try {
      if (await exists(join(attempt.fixture, '.git'))) {
        await writeFile(join(attempt.evidence, 'final.diff'), await checked('git', ['diff', 'HEAD'], {cwd: attempt.fixture}));
        await attempt.record('git-status', await checked('git', ['status', '--porcelain=v1', '--untracked-files=all'], {cwd: attempt.fixture}));
      }
    } catch (e) { attempt.result.missingEvidence.push(`Final diff: ${e}`); attempt.result.status = 'failed'; }
    attempt.result.finishedAt = new Date().toISOString(); await attempt.save();
  }
  return attempt.result.status === 'passed' ? 0 : 1;
}

export function isMain(url: string) { return !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url; }
