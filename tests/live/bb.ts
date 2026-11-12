import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Attempt, change, checked, checkWorkers, collectPages, command, hashes, help, independentChecks,
  isMain, lifecycle, options, pause, prepareFixture, repository, type Command, type Options } from './common.js';

async function packageHashes(root: string) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const files: Record<string, string> = {};
  for (const path of ['package.json', 'package-lock.json', 'LICENSE']) {
    files[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  }
  for (const dir of pkg.files.filter((p: string) => p !== 'LICENSE')) {
    for (const [path, hash] of Object.entries(await hashes(join(root, dir)))) files[`${dir}/${path}`] = hash;
  }
  return files;
}

export async function pluginIdentity(run = command, signal?: AbortSignal) {
  return {source: await realpath(repository), revision: (await checked('git', ['rev-parse', 'HEAD'], {signal}, run)).trim(),
    dirty: await checked('git', ['status', '--porcelain=v1'], {signal}, run), hashes: await packageHashes(repository)};
}

export async function bbJson(args: string[], run: Command = command, env?: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<unknown> {
  const output = await checked('bb', [...args, '--json'], {env, signal}, run);
  return JSON.parse(output);
}

export async function bbPreflight(attempt: Attempt, signal: AbortSignal, run = command) {
  const input = attempt.options;
  const plugins = await bbJson(['plugin', 'list'], run, undefined, signal) as {plugins: {id: string; source: string; rootDir: string; enabled: boolean; status: string}[]};
  assert(Array.isArray(plugins.plugins), 'Invalid bb plugin catalogue');
  await attempt.record('plugins', plugins);
  const loop = plugins.plugins.find(p => p.id === 'openspec-verify-loop');
  assert(loop?.enabled && loop.status === 'running', 'Install and enable the loop plugin explicitly before testing');
  if (loop.source.startsWith('git:')) {
    // A git install adds bb's own bundles beside the committed ones, so compare only the tested checkout's files.
    const tested = await packageHashes(repository), installed = await packageHashes(loop.rootDir);
    assert(Object.entries(tested).every(([path, hash]) => installed[path] === hash), 'Installed git plugin files differ from the tested checkout');
  } else {
    assert.equal(loop.source, `path:${repository.replace(/\/$/, '')}`, `Install the tested checkout explicitly: bb plugin install path:${repository.replace(/\/$/, '')} --yes`);
    assert.equal(await realpath(loop.rootDir), await realpath(repository), 'Installed plugin root differs from tested checkout');
  }
  assert(plugins.plugins.some(p => p.id === 'workflows' && p.enabled && p.status === 'running'), 'Enable bb Workflows explicitly before testing');
  const providers = await bbJson(['provider', 'list'], run, undefined, signal) as {id: string; available: boolean}[];
  assert(Array.isArray(providers) && providers.some(p => p.id === input.provider && p.available), 'Selected bb provider unavailable');
  const models = await bbJson(['provider', 'models', input.provider], run, undefined, signal) as {id: string; supportedReasoningEfforts?: {reasoningEffort: string}[]; defaultReasoningEffort?: string}[];
  assert(Array.isArray(models), 'Invalid bb model catalogue');
  const model = models.find(m => m.id === input.model);
  assert(model, 'Selected bb model unavailable');
  const reasoning = input.reasoning ?? model.defaultReasoningEffort;
  assert(reasoning, 'Choose --reasoning-level explicitly for a model without a declared default');
  assert(model.supportedReasoningEfforts?.some(e => e.reasoningEffort === reasoning), 'Selected reasoning level is unavailable; see known issues for ACP compatibility profiles');
  assert(input.mode === 'auto' || input.mode === 'full', 'Explicit auto/full permission mode is required');
  if (input.provider.startsWith('acp-')) assert.equal(input.mode, 'full', 'ACP requires full');
  attempt.result.resolvedSettings = {provider: input.provider, model: input.model, reasoningLevel: reasoning, permissionMode: input.mode};
  attempt.result.plugin = await pluginIdentity(run, signal);
  const context = await bbJson(['status'], run, undefined, signal) as {dataDir: string; thread?: {environment?: {hostId?: string}}};
  attempt.result.hostInfo = {version: (await checked('bb', ['--version'], {signal}, run)).trim(), dataDir: context.dataDir,
    hostId: context.thread?.environment?.hostId};
  await attempt.save();
  return {reasoning, context};
}

export async function checkPluginUnchanged(attempt: Attempt, run = command, signal?: AbortSignal) {
  const after = await pluginIdentity(run, signal);
  const before = attempt.result.plugin as Awaited<ReturnType<typeof pluginIdentity>>;
  assert(before, 'Missing initial plugin identity');
  attempt.check('Tested plugin files remained unchanged', JSON.stringify(before.hashes) === JSON.stringify(after.hashes));
  await attempt.record('plugin-after', after);
}

type Thread = {id: string; projectId: string; environmentId: string | null; providerId: string; status: string;
  title?: string; queuedMessageCount?: number; activeBackgroundAgentCount?: number};
type Event = {seq: number; type: string; createdAt: number; data: {
  input?: {text?: string}[]; item?: {type: string; command?: string; text?: string}; execution?: unknown;
}};
type RunRow = {id: string; originThreadId: string; status: string};
type Summary = {id: string; status: string; finishedAt?: number; result?: Record<string, unknown>;
  resultOmitted?: boolean; calls: {running: number; queued: number}};
type HistoryRecord = {type: string; id?: string; args?: {change?: string; procedurePath?: string};
  result?: Record<string, unknown>; source?: string; sourceHash?: string; hasMore?: boolean; nextCursor?: number | null;
  childThreadId?: string; phase?: string; status?: string; startedAt?: number; createdAt?: number; finishedAt?: number;
  resolvedProvider?: string; resolvedModel?: string; resolvedReasoningLevel?: string; resolvedPermissionMode?: string};
const terminal = (status: string) => ['succeeded', 'failed', 'cancelled'].includes(status);
const inactive = (thread: Thread) => ['idle', 'error'].includes(thread.status) &&
  !thread.queuedMessageCount && !thread.activeBackgroundAgentCount;

export function bbItems(events: Event[]) { return events.filter(e => e.type === 'item/completed' && e.data.item); }
export function bbLaunchChecks(attempt: Attempt, events: Event[], history: HistoryRecord[], summary: Summary) {
  const items = bbItems(events);
  const launches = items.filter(e => /\bbb\s+workflows\s+run\b/.test(e.data.item!.command ?? ''));
  const messages = items.filter(e => e.data.item!.type === 'agentMessage');
  const previews = messages.flatMap(e => [...(e.data.item!.text ?? '').matchAll(/::workflow-preview\{run="([^"]+)"\}/g)].map(m => m[1]));
  attempt.check('One skill launch and matching preview', launches.length === 1 && previews.length === 1 && previews[0] === attempt.result.runId);
  const firstEnd = events.find(e => e.type === 'turn/completed');
  attempt.check('Launch turn ends before workflow completion', !!firstEnd && !!summary.finishedAt && firstEnd.createdAt < summary.finishedAt);
  const run = history.find(h => h.type === 'run');
  const selected = attempt.result.selectedProcedure as {path: string; verified: boolean} | undefined;
  attempt.check('Change and supplied procedure reach workflow', run?.args?.change === change &&
    run.args.procedurePath === selected?.path && selected?.verified === true, selected);
  const source = run?.source;
  const file = attempt.result.loopSource as string;
  // The documented --script "$(cat file)" transport removes trailing LF bytes.
  attempt.check('Installed shared loop runs unchanged', typeof source === 'string' &&
    (source === file || source === file.replace(/\n+$/, '')) && run?.sourceHash === createHash('sha256').update(source).digest('hex'));
  const notice = events.find(e => e.type === 'client/turn/requested' && e.data.input?.some(i =>
    i.text?.includes('[BB workflow finished') && i.text.includes(attempt.result.runId!)));
  const replies = notice ? messages.filter(e => e.seq > notice.seq) : [];
  const status = attempt.result.terminal?.status;
  const statusPattern = summary.status === 'cancelled' ? /\b(cancelled|canceled|stopped|interrupted)\b/i : new RegExp(`\\b${status}\\b`, 'i');
  attempt.check('Completion is reported', !!notice && replies.some(e => (e.data.item!.text ?? '').includes(attempt.result.runId!) &&
    statusPattern.test(e.data.item!.text ?? '')) && events.some(e => e.type === 'turn/completed' && e.seq > notice.seq));
}

export async function runBb(input: Options, run: Command = command) {
  const attempt = await Attempt.create(input);
  let environmentId: string | undefined, spawnAttempted = false, spawnUncertain = false, stopSent = false;
  let stopWorkers: string[] = [];
  const knownRuns = new Set<string>(), knownWorkers = new Set<string>();
  const eventCache = new Map<string, Event[]>();
  const env = () => ({...process.env, BB_PROJECT_ID: attempt.result.projectId,
    BB_THREAD_ID: attempt.result.originId, BB_ENVIRONMENT_ID: environmentId});
  const json = <T>(args: string[], signal: AbortSignal) => bbJson(args, run, env(), signal) as Promise<T>;
  async function thread(id: string, signal: AbortSignal) {
    const row = await json<{thread: Thread; environment: {path: string}}>(['thread', 'show', id], signal);
    assert.equal(row.thread.id, id, 'Unexpected thread identity');
    assert.equal(await realpath(row.environment.path), attempt.fixture, 'Thread left the fixture checkout');
    return row.thread;
  }
  async function events(id: string, signal: AbortSignal) {
    const previous = eventCache.get(id) ?? [];
    const more = await collectPages<Event, number>(async cursor => {
      const after = cursor ?? previous.at(-1)?.seq;
      const rows = await json<Event[]>(['thread', 'log', id, '--format', 'json', '--limit', '100',
        ...(after === undefined ? [] : ['--after-seq', String(after)])], signal);
      assert(Array.isArray(rows), 'Thread event page missing; evidence incomplete');
      let last = after ?? 0;
      for (const event of rows) { assert(event.seq > last, 'Thread event cursor did not advance'); last = event.seq; }
      return {items: rows, next: rows.length === 100 ? last : undefined};
    }, signal);
    if (more.length) await attempt.record(`thread-${id}`, more);
    const all = [...previous, ...more]; assert(all.length <= 100_000, 'Thread evidence exceeded collection bound');
    eventCache.set(id, all);
    return all;
  }
  async function history(signal: AbortSignal) {
    return collectPages<HistoryRecord, number>(async cursor => {
      const output = await checked('bb', ['workflows', 'history', attempt.result.runId!, '--cursor', String(cursor ?? 0), '--limit', '100', '--json'], {env: env(), signal}, run);
      const records: HistoryRecord[] = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const page = records.find(r => r.type === 'page'); assert(page, 'Missing workflow history page; evidence incomplete');
      if (page.hasMore) assert(typeof page.nextCursor === 'number', 'Missing workflow history cursor');
      await attempt.record('workflow-history', records);
      return {items: records, next: page.hasMore ? page.nextCursor : undefined};
    }, signal);
  }
  async function observe(signal: AbortSignal) {
    const origin = await thread(attempt.result.originId!, signal);
    const originEvents = await events(origin.id, signal);
    const runs = await json<RunRow[]>(['workflows', 'list', '--limit', '50'], signal);
    assert(Array.isArray(runs), 'Workflow list missing; evidence incomplete');
    for (const row of runs) knownRuns.add(row.id);
    await attempt.record('workflow-list', runs);
    assert(runs.length <= 1 && runs.every(r => r.originThreadId === origin.id), 'Unexpected additional workflow in fixture project');
    attempt.result.runId = runs[0]?.id;
    if (!attempt.result.runId) { await attempt.save(); return {origin, originEvents}; }
    const summary = await json<Summary>(['workflows', 'status', attempt.result.runId], signal);
    const records = await history(signal);
    const procedurePath = records.find(r => r.type === 'run')?.args?.procedurePath;
    const selected = attempt.result.selectedProcedure as {path: string; verified: boolean} | undefined;
    if (procedurePath && !(selected?.path === procedurePath && selected.verified)) {
      // bb may pass a temporary materialized skill rather than the original project path.
      try {
        const content = await hashes(dirname(procedurePath));
        const expected = (attempt.result.procedure as {hashes: Record<string, string>}).hashes;
        attempt.result.selectedProcedure = {path: procedurePath, hashes: content, verified: JSON.stringify(content) === JSON.stringify(expected)};
      } catch (error) { attempt.result.selectedProcedure = {path: procedurePath, verified: false, error: String(error)}; }
      await attempt.record('selected-procedure', attempt.result.selectedProcedure);
    }
    const calls = records.filter(r => r.type === 'call' && r.childThreadId);
    attempt.result.workers = [];
    for (const call of calls) {
      const id = call.childThreadId!; knownWorkers.add(id);
      assert(call.phase === 'Verify' || call.phase === 'Fix', 'Unknown worker role in workflow history');
      const native = await thread(id, signal); await events(id, signal);
      attempt.result.workers.push({id, role: call.phase === 'Verify' ? 'verifier' : 'fixer',
        start: call.startedAt ?? call.createdAt!, end: call.finishedAt ?? undefined,
        active: call.status === 'running' && ['active', 'starting'].includes(native.status),
        settings: {provider: call.resolvedProvider, model: call.resolvedModel,
          reasoningLevel: call.resolvedReasoningLevel, permissionMode: call.resolvedPermissionMode}});
    }
    const result = summary.result ?? records.find(r => r.type === 'run')?.result;
    attempt.result.terminal = terminal(summary.status) ? result ?? {status: summary.status} : undefined;
    await attempt.record('workflow-status', summary); await attempt.save();
    return {origin, originEvents, summary, records};
  }
  async function requestStop(signal: AbortSignal) {
    stopSent = true;
    const path = join(attempt.root, 'stop.txt');
    await writeFile(path, `Stop the running verification loop ${attempt.result.runId}. Use the installed openspec-verify-loop skill's stop instructions.\n`);
    await json(['thread', 'tell', attempt.result.originId!, '--message-file', path, '--mode', 'auto'], signal);
    await attempt.record('stop-request', {runId: attempt.result.runId, workers: stopWorkers});
  }
  const code = await lifecycle(attempt, async signal => {
    const boundedRun: Command = (file, args, opts) => run(file, args, {...opts, signal});
    await prepareFixture(attempt, boundedRun);
    const {reasoning, context} = await bbPreflight(attempt, signal, run);
    attempt.result.loopSource = await readFile(join(repository, 'skills/openspec-verify-loop/verify-loop.js'), 'utf8');
    const project = await bbJson(['project', 'create', '--name', basename(attempt.root), '--root', attempt.fixture,
      ...(context.thread?.environment?.hostId ? ['--machine', context.thread.environment.hostId] : [])], run, undefined, signal) as {id: string};
    assert(typeof project.id === 'string', 'Project identity missing'); attempt.result.projectId = project.id; await attempt.save();
    const prompt = join(attempt.root, 'start.txt');
    await writeFile(prompt, `Use the installed openspec-verify-loop skill on change ${change}.\n`);
    const title = `Greeting ${basename(attempt.root)}`;
    const args = ['thread', 'spawn', '--project', project.id, '--environment', attempt.fixture, '--provider', input.provider,
      '--model', input.model, '--reasoning-level', reasoning, '--permission-mode', input.mode!, '--title', title, '--prompt-file', prompt];
    attempt.result.stage = 'execution'; spawnAttempted = true; spawnUncertain = true;
    let origin: Thread;
    try { origin = await bbJson(args, run, undefined, signal) as Thread; }
    catch (error) {
      const candidates = await bbJson(['thread', 'list', '--project', project.id], run, undefined, signal) as Thread[];
      assert(Array.isArray(candidates) && candidates.length === 1 && candidates[0]!.title === title && candidates[0]!.providerId === input.provider,
        `Thread admission uncertain; do not resubmit. Project: ${project.id}. Error: ${error}`);
      origin = candidates[0]!;
      await attempt.record('spawn-reconciliation', {error: String(error), origin});
    }
    await attempt.record('spawn-result', origin);
    assert(typeof origin.id === 'string' && origin.projectId === project.id, 'Origin identity missing or mismatched');
    attempt.result.originId = origin.id; spawnUncertain = false; await attempt.save();
    // Spawn can return before the project-checkout environment has attached.
    while (!environmentId) {
      const attached = await json<{thread: Thread; environment: {id: string; path: string} | null}>(['thread', 'show', origin.id], signal);
      assert.equal(attached.thread.projectId, project.id);
      if (attached.environment && attached.thread.environmentId) {
        assert.equal(await realpath(attached.environment.path), attempt.fixture, 'Origin attached outside the fixture');
        environmentId = attached.thread.environmentId;
      } else {
        assert.notEqual(attached.thread.status, 'error', 'Origin environment setup failed');
        await pause(signal);
      }
    }
    attempt.result.stage = 'observation';
    for (;;) {
      const current = await observe(signal);
      const launched = current.originEvents.some(e => e.type === 'turn/completed');
      const activeWorkers = attempt.result.workers.filter(w => w.active);
      if (input.scenario === 'stop' && !stopSent && launched && activeWorkers.length && !attempt.result.terminal) {
        stopWorkers = activeWorkers.map(w => w.id); await requestStop(signal);
      }
      const notice = current.originEvents.find(e => e.type === 'client/turn/requested' && e.data.input?.some(i =>
        i.text?.includes('[BB workflow finished') && i.text.includes(attempt.result.runId!)));
      const reported = notice && current.originEvents.some(e => e.type === 'turn/completed' && e.seq > notice.seq);
      if (current.summary && terminal(current.summary.status) && reported && inactive(current.origin)) {
        attempt.result.stage = 'assertion';
        bbLaunchChecks(attempt, current.originEvents, current.records!, current.summary);
        // Workers read the procedure late; a provider's temporary skill copy can be gone by then (known issues).
        const supplied = attempt.result.selectedProcedure as {path: string; hashes?: Record<string, string>} | undefined;
        attempt.check('Supplied procedure outlives the run', !!supplied?.hashes &&
          JSON.stringify(await hashes(dirname(supplied.path)).catch(() => null)) === JSON.stringify(supplied.hashes), supplied?.path);
        checkWorkers(attempt, attempt.result.resolvedSettings);
        if (input.scenario === 'fix-to-clean') await independentChecks(attempt, signal, run);
        else {
          if (!stopSent || current.summary.status === 'succeeded') attempt.result.status = 'not_exercised';
          const stops = bbItems(current.originEvents).filter(e => /\bbb\s+workflows\s+stop\b/.test(e.data.item!.command ?? '') &&
            e.data.item!.command!.includes(attempt.result.runId!));
          attempt.check('Normal user stop cancels active work', stopSent && stopWorkers.length > 0 && stops.length === 1 && current.summary.status === 'cancelled');
          attempt.check('No workers after accepted stop', stops.length === 1 && attempt.result.workers.every(w => w.start <= stops[0]!.createdAt));
        }
        break;
      }
      // A failed launch turn without a run cannot ever produce a completion notice.
      if (!attempt.result.runId && launched && inactive(current.origin)) throw new Error('Skill launch ended without a workflow');
      await pause(signal);
    }
  }, async signal => {
    try {
      if (!attempt.result.originId) {
        assert(!spawnUncertain, `Origin admission uncertain in project ${attempt.result.projectId}`);
        attempt.result.cleanup.confirmed = !spawnAttempted; return;
      }
      let current;
      try { current = await observe(signal); } catch (e) { await attempt.record('cleanup-observation-error', String(e)); }
      if (knownRuns.size === 1 && current?.summary && !terminal(current.summary.status) && !stopSent) {
        const soft = AbortSignal.any([signal, AbortSignal.timeout(Math.min(20_000, input.cleanupTimeout / 2))]);
        try {
          await requestStop(soft);
          while (!terminal((await observe(soft)).summary?.status ?? '')) await pause(soft);
        } catch (e) { await attempt.record('cleanup-stop-error', String(e)); }
      }
      for (const id of knownRuns) {
        const status = await json<Summary>(['workflows', 'status', id], signal);
        if (!terminal(status.status) || status.calls.running || status.calls.queued) {
          attempt.result.cleanup.fallback = true;
          await json(['workflows', 'stop', id], signal);
          await attempt.record('native-cleanup', {runId: id});
        }
      }
      for (const id of [...knownWorkers, attempt.result.originId]) {
        let row = await thread(id, signal);
        if (!inactive(row)) {
          attempt.result.cleanup.fallback = true;
          await json(['thread', 'stop', id], signal);
          await attempt.record('native-cleanup', {threadId: id});
          do { row = await thread(id, signal); if (inactive(row)) break; await pause(signal); } while (!signal.aborted);
        }
        assert(inactive(row), `Thread inactivity is unconfirmed: ${id}`);
      }
      assert(!spawnUncertain && knownRuns.size > 0, 'Run admission unknown; inspect retained origin');
      for (const id of knownRuns) {
        const status = await json<Summary>(['workflows', 'status', id], signal);
        assert(terminal(status.status) && !status.calls.running && !status.calls.queued, `Workflow still has pending work: ${id}`);
      }
      attempt.result.cleanup.confirmed = true;
      if (input.scenario === 'stop' && attempt.result.cleanup.fallback) {
        attempt.check('Normal stop required no native fallback', false); attempt.result.status = 'failed';
      }
    } finally {
      if (attempt.result.plugin) {
        await checkPluginUnchanged(attempt, run, signal);
        if (!attempt.result.assertions.at(-1)?.passed && attempt.result.status === 'passed') attempt.result.status = 'failed';
      }
    }
  });
  return {attempt, code};
}

if (isMain(import.meta.url)) {
  try {
    const input = options('bb', process.argv.slice(2));
    if (!input) console.log(help('bb'));
    else { const {attempt, code} = await runBb(input); console.log(`${attempt.result.status}: ${attempt.evidence}/summary.md`); process.exitCode = code; }
  } catch (e) { console.error(String(e)); process.exitCode = 1; }
}
