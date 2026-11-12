import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Attempt, command, repository, type Command, type Options } from './live/common.js';
import { bbPreflight, checkPluginUnchanged, runBb } from './live/bb.js';

test('bb preflight verifies installed source/settings without global mutation and detects changed tested files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'live-bb-unit-')); t.after(() => rm(root, {recursive: true, force: true}));
  const input: Options = {host: 'bb', scenario: 'fix-to-clean', provider: 'fake', model: 'model', variant: 'default', mode: 'auto',
    procedure: '/unused/SKILL.md', timeout: 1000, cleanupTimeout: 1000, output: root};
  let wrongSource = false; let gitRoot = '';
  const calls: string[][] = [];
  const fake: Command = async (file, args, opts) => {
    if (file !== 'bb') return command(file, args, opts);
    calls.push(args);
    let result: unknown;
    if (args[0] === 'plugin') result = {plugins: [{id: 'openspec-verify-loop', enabled: true, status: 'running',
      source: gitRoot ? 'git:github.com/example/openspec-verify-loop@abc' : wrongSource ? 'path:/other/checkout' : `path:${repository.replace(/\/$/, '')}`,
      rootDir: gitRoot || repository},
    {id: 'workflows', enabled: true, status: 'running'}]};
    else if (args[0] === 'provider' && args[1] === 'list') result = [{id: 'fake', available: true}];
    else if (args[0] === 'provider') result = [{id: 'model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{reasoningEffort: 'medium'}]}];
    else if (args[0] === 'status') result = {dataDir: root};
    else if (args[0] === '--version') return {code: 0, stdout: 'fake', stderr: ''};
    else throw new Error(`Unexpected bb command: ${args}`);
    return {code: 0, stdout: JSON.stringify(result), stderr: ''};
  };
  const attempt = await Attempt.create(input);
  const selected = await bbPreflight(attempt, AbortSignal.timeout(5000), fake);
  assert.equal(selected.reasoning, 'medium');
  await checkPluginUnchanged(attempt, fake); assert.equal(attempt.result.assertions.at(-1)?.passed, true);
  (attempt.result.plugin as {hashes: Record<string, string>}).hashes['package.json'] = 'changed';
  await checkPluginUnchanged(attempt, fake); assert.equal(attempt.result.assertions.at(-1)?.passed, false);
  wrongSource = true;
  await assert.rejects(bbPreflight(await Attempt.create(input), AbortSignal.timeout(5000), fake), /Install the tested checkout/);
  // A git install's cached copy may carry bb-built bundles, but every tested file must match.
  gitRoot = join(root, 'git-install');
  const pkg = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  for (const path of ['package.json', 'package-lock.json', ...pkg.files]) await cp(join(repository, path), join(gitRoot, path), {recursive: true});
  await writeFile(join(gitRoot, 'dist/server.js'), 'built by bb');
  await bbPreflight(await Attempt.create(input), AbortSignal.timeout(5000), fake);
  await writeFile(join(gitRoot, 'dist/index.js'), 'stale');
  await assert.rejects(bbPreflight(await Attempt.create(input), AbortSignal.timeout(5000), fake), /differ from the tested checkout/);
  assert(!calls.some(args => args.includes('install') || args.includes('enable') || args.includes('config')));
});

async function fakeBb(t: {after(fn: () => unknown): void}, settings: {scenario?: Options['scenario']; race?: boolean;
  wrongModel?: boolean; failCleanup?: boolean; lostSpawn?: boolean; pages?: boolean; blockedVerdict?: boolean; stagedProcedure?: boolean; lostProcedure?: boolean; badPreview?: boolean} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'live-bb-records-')); t.after(() => rm(root, {recursive: true, force: true}));
  const procedure = join(root, 'installed'); await mkdir(procedure);
  await writeFile(join(procedure, 'SKILL.md'), '---\nname: openspec-verify-change\n---\nTest procedure\n');
  const input: Options = {host: 'bb', scenario: settings.scenario ?? 'fix-to-clean', provider: 'fake', model: 'model',
    mode: 'auto', reasoning: 'medium', variant: 'default', procedure: join(procedure, 'SKILL.md'), output: root, timeout: 10_000, cleanupTimeout: 1000};
  const source = (await readFile(join(repository, 'skills/openspec-verify-loop/verify-loop.js'), 'utf8')).replace(/\n+$/, '');
  const stage = join(root, 'stage/openspec-verify-change');
  const calls: {args: string[]; env?: NodeJS.ProcessEnv}[] = [];
  let fixture = '', title = '', poll = 0, stopped = false, attached = false, attachmentReads = 0;
  const done = () => stopped || settings.race || (input.scenario === 'fix-to-clean' && poll >= 2);
  const status = () => stopped ? 'cancelled' : done() ? 'succeeded' : 'running';
  const native = (id: string) => ({id, projectId: 'project', environmentId: 'environment', providerId: 'fake', title,
    status: id === 'origin' || (done() && !settings.failCleanup) ? 'idle' : 'active', queuedMessageCount: 0, activeBackgroundAgentCount: 0});
  const firstEvents = () => [
    {seq: 1, type: 'item/completed', createdAt: 1000, data: {item: {type: 'commandExecution', command: 'bb workflows run --script "$script" --args "$args" --json'}}},
    {seq: 2, type: 'item/completed', createdAt: 1005, data: {item: {type: 'agentMessage', text: `::workflow-preview{run="${settings.badPreview ? 'wfr_tset' : 'wfr_test'}"}`}}},
    {seq: 3, type: 'turn/completed', createdAt: 1010, data: {}},
    ...(settings.pages ? Array.from({length: 97}, (_, i) => ({seq: 4 + i, type: 'item/started', createdAt: 1015, data: {}})) : []),
  ];
  const originEvents = () => {
    const rows = firstEvents(), base = rows.length;
    if (done()) {
      if (stopped) rows.push({seq: base + 1, type: 'item/completed', createdAt: 1800,
        data: {item: {type: 'commandExecution', command: 'bb workflows stop wfr_test'}}} as typeof rows[number]);
      rows.push({seq: base + 2, type: 'client/turn/requested', createdAt: 1850,
        data: {input: [{text: '[BB workflow finished · wfr_test]'}]}} as unknown as typeof rows[number]);
      rows.push({seq: base + 3, type: 'item/completed', createdAt: 1900,
        data: {item: {type: 'agentMessage', text: `Run wfr_test ${stopped ? 'stopped' : settings.blockedVerdict ? 'blocked' : 'clean'} for add-greeting after 2 verifications.`}}} as typeof rows[number]);
      rows.push({seq: base + 4, type: 'turn/completed', createdAt: 2000, data: {}} as typeof rows[number]);
    }
    return rows;
  };
  const run: Command = async (file, args, opts) => {
    if (file !== 'bb') return command(file, args, opts);
    calls.push({args, env: opts?.env});
    let data: unknown;
    if (args[0] === '--version') return {code: 0, stdout: 'fake', stderr: ''};
    if (args[0] === 'plugin') data = {plugins: [{id: 'openspec-verify-loop', enabled: true, status: 'running', source: `path:${repository.replace(/\/$/, '')}`, rootDir: repository}, {id: 'workflows', enabled: true, status: 'running'}]};
    else if (args[0] === 'provider' && args[1] === 'list') data = [{id: 'fake', available: true}];
    else if (args[0] === 'provider') data = [{id: 'model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{reasoningEffort: 'medium'}]}];
    else if (args[0] === 'status') data = {dataDir: root};
    else if (args[0] === 'project' && args[1] === 'create') data = {id: 'project'};
    else if (args[0] === 'thread' && args[1] === 'spawn') {
      fixture = args[args.indexOf('--environment') + 1]!; title = args[args.indexOf('--title') + 1]!;
      if (settings.stagedProcedure) await cp(join(fixture, '.bb/skills/openspec-verify-change'), stage, {recursive: true});
      const prompt = await readFile(args[args.indexOf('--prompt-file') + 1]!, 'utf8');
      assert.match(prompt, /Use the installed openspec-verify-loop skill on change add-greeting/);
      if (settings.lostSpawn) throw new Error('lost spawn response');
      data = {...native('origin'), environmentId: null};
    } else if (args[0] === 'thread' && args[1] === 'list') data = [native('origin')];
    else if (args[0] === 'thread' && args[1] === 'show') {
      if (args[2] === 'origin' && settings.pages && !attachmentReads++) {
        return {code: 0, stdout: JSON.stringify({thread: {...native('origin'), environmentId: null, status: 'pending'}, environment: null}), stderr: ''};
      }
      if (args[2] === 'origin') { if (attached) poll++; else attached = true; }
      data = {thread: native(args[2]!), environment: {path: fixture}};
    } else if (args[0] === 'thread' && args[1] === 'log') {
      const rows = args[2] === 'origin' ? originEvents() : [{seq: 1, type: 'client/turn/requested', createdAt: 1200, data: {}}];
      const cursor = args.includes('--after-seq') ? Number(args[args.indexOf('--after-seq') + 1]) : 0;
      data = rows.filter(e => e.seq > cursor).slice(0, 100);
    } else if (args[0] === 'thread' && args[1] === 'tell') {
      assert.match(await readFile(args[args.indexOf('--message-file') + 1]!, 'utf8'), /Stop the running verification loop wfr_test/);
      stopped = true; data = {threadId: 'origin'};
    } else if (args[0] === 'thread' && args[1] === 'stop') {
      if (settings.failCleanup) return {code: 1, stdout: '', stderr: 'cannot stop worker'};
      data = {};
    } else if (args[0] === 'workflows') {
      assert.equal(opts?.env?.BB_PROJECT_ID, 'project'); assert.equal(opts?.env?.BB_THREAD_ID, 'origin');
      if (args[1] === 'list') data = [{id: 'wfr_test', originThreadId: 'origin', status: status()}];
      else if (args[1] === 'stop') { stopped = true; data = {status: 'cancelled'}; }
      else if (args[1] === 'status') {
        if (done() && !stopped) await writeFile(join(fixture, 'greet.mjs'), "export const greet = name => `Hello, ${name || 'world'}!`;\n");
        if (done() && settings.lostProcedure) await rm(stage, {recursive: true, force: true});
        data = {id: 'wfr_test', status: status(), finishedAt: done() ? 1800 : undefined, calls: {running: done() ? 0 : 1, queued: 0},
          result: done() && !stopped ? {status: settings.blockedVerdict ? 'blocked' : 'clean', change: 'add-greeting', rounds: 2,
            ...(settings.blockedVerdict ? {reason: 'Unrecognized verifier result', report: 'VERDICT: CLEAN\nAdditional footer'} : {})} : undefined};
      } else if (args[1] === 'history') {
        const cursor = Number(args[args.indexOf('--cursor') + 1]);
        const count = done() && !stopped ? 3 : 1;
        const workers = Array.from({length: count}, (_, index) => ({type: 'call', childThreadId: `worker-${index}`,
          phase: index % 2 ? 'Fix' : 'Verify', status: done() ? 'succeeded' : 'running', createdAt: 1200 + index * 100,
          startedAt: 1200 + index * 100, finishedAt: done() ? 1250 + index * 100 : undefined,
          resolvedProvider: 'fake', resolvedModel: settings.wrongModel ? 'other' : 'model', resolvedReasoningLevel: 'medium', resolvedPermissionMode: 'auto'}));
        const selected = settings.pages && cursor === 0 ? workers.slice(0, 1) : settings.pages ? workers.slice(cursor) : workers;
        const records = [{type: 'run', id: 'wfr_test', source, sourceHash: createHash('sha256').update(source).digest('hex'),
          args: {change: 'add-greeting', procedurePath: settings.stagedProcedure ? join(stage, 'SKILL.md') : join(fixture, '.bb/skills/openspec-verify-change/SKILL.md')}}, ...selected,
        {type: 'page', hasMore: settings.pages && cursor === 0 && workers.length > 1, nextCursor: 1}];
        return {code: 0, stdout: records.map(r => JSON.stringify(r)).join('\n'), stderr: ''};
      } else throw new Error(`Unexpected workflows command: ${args}`);
    } else throw new Error(`Unexpected bb command: ${args}`);
    return {code: 0, stdout: JSON.stringify(data), stderr: ''};
  };
  return {input, run, calls};
}

test('bb skill launch uses one origin, project-scoped paginated history and unchanged loop with inherited settings', async t => {
  const fake = await fakeBb(t, {pages: true, lostSpawn: true, stagedProcedure: true});
  const {attempt, code} = await runBb(fake.input, fake.run);
  assert.equal(code, 0, JSON.stringify(attempt.result));
  assert.equal(fake.calls.filter(c => c.args[0] === 'thread' && c.args[1] === 'spawn').length, 1);
  assert(!fake.calls.some(c => c.args[0] === 'workflows' && c.args[1] === 'run'));
  assert(!fake.calls.some(c => c.args.includes('commands') || c.args.includes('catalogue')));
  assert.equal(attempt.result.workers.length, 3);
  assert.equal((attempt.result.selectedProcedure as {verified: boolean}).verified, true);
  assert.match((attempt.result.selectedProcedure as {path: string}).path, /stage/);
});

test('bb normal active stop is reported and a completion race is not a stop pass', async t => {
  const fake = await fakeBb(t, {scenario: 'stop'});
  const stopped = await runBb(fake.input, fake.run);
  assert.equal(stopped.code, 0, JSON.stringify(stopped.attempt.result));
  assert(!fake.calls.some(c => c.args[0] === 'workflows' && c.args[1] === 'stop'));
  const raced = await fakeBb(t, {scenario: 'stop', race: true});
  const result = await runBb(raced.input, raced.run);
  assert.equal(result.code, 1); assert.equal(result.attempt.result.status, 'not_exercised');
});

test('bb model mismatch fails and failed native cleanup retains identities and evidence', async t => {
  const wrong = await fakeBb(t, {wrongModel: true});
  const mismatch = await runBb(wrong.input, wrong.run);
  assert.equal(mismatch.code, 1); assert.equal(mismatch.attempt.result.assertions.find(c => c.name === 'Workers inherit settings')?.passed, false);
  const broken = await fakeBb(t, {scenario: 'stop', failCleanup: true});
  const retained = await runBb(broken.input, broken.run);
  assert.equal(retained.code, 1); assert.equal(retained.attempt.result.cleanup.confirmed, false);
  assert.equal(retained.attempt.result.originId, 'origin');
  assert(retained.attempt.result.workers.some(w => w.id === 'worker-0'));
  assert.match(await readFile(join(retained.attempt.evidence, 'result.json'), 'utf8'), /cannot stop worker/);
});

test('bb preserves a blocked verifier result as unsuccessful convergence without relaunching', async t => {
  const fake = await fakeBb(t, {blockedVerdict: true});
  const {attempt, code} = await runBb(fake.input, fake.run);
  assert.equal(code, 1); assert.equal(attempt.result.terminal?.status, 'blocked');
  assert.equal(attempt.result.assertions.find(c => c.name === 'Loop ended clean')?.passed, false);
  assert.equal(attempt.result.stage, 'assertion'); assert.equal(attempt.result.errors.length, 0);
  assert.equal(attempt.result.cleanup.confirmed, true);
  assert.equal(fake.calls.filter(c => c.args[0] === 'thread' && c.args[1] === 'spawn').length, 1);
});

test('bb clean repair still fails when the preview names a different run', async t => {
  const fake = await fakeBb(t, {badPreview: true});
  const {attempt, code} = await runBb(fake.input, fake.run);
  assert.equal(code, 1); assert.equal(attempt.result.terminal?.status, 'clean');
  assert.equal(attempt.result.assertions.find(c => c.name === 'One skill launch and matching preview')?.passed, false);
  assert.equal(attempt.result.assertions.find(c => c.name === 'Independent greeting behavior')?.passed, true);
  assert.equal(attempt.result.cleanup.confirmed, true);
  assert.equal(fake.calls.filter(c => c.args[0] === 'thread' && c.args[1] === 'spawn').length, 1);
});

test('bb fails a run whose supplied procedure is a temporary copy deleted during the run', async t => {
  const fake = await fakeBb(t, {stagedProcedure: true, lostProcedure: true});
  const {attempt, code} = await runBb(fake.input, fake.run);
  assert.equal(code, 1); assert.equal(attempt.result.terminal?.status, 'clean');
  assert.equal(attempt.result.assertions.find(c => c.name === 'Change and supplied procedure reach workflow')?.passed, true);
  assert.equal(attempt.result.assertions.find(c => c.name === 'Supplied procedure outlives the run')?.passed, false);
});
