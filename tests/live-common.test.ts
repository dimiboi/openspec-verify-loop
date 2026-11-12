import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Attempt, options, prepareFixture, independentChecks, hashes, collectPages, lifecycle, notices, type Options } from './live/common.js';

async function setup(t: {after(fn: () => unknown): void}, scenario: Options['scenario'] = 'fix-to-clean') {
  const root = await mkdtemp(join(tmpdir(), 'live-unit-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const skill = join(root, 'procedure'); await mkdir(skill);
  await writeFile(join(skill, 'SKILL.md'), '---\nname: openspec-verify-change\n---\nInstalled test procedure\n');
  await writeFile(join(skill, 'resource.txt'), 'relative resource');
  const input: Options = {host: 'bb', scenario, provider: 'fake', model: 'fake', variant: 'default',
    mode: 'auto', procedure: join(skill, 'SKILL.md'), output: root, timeout: 5000, cleanupTimeout: 1000};
  return {root, input, attempt: await Attempt.create(input)};
}

test('each attempt starts broken and copies all procedure resources without modifying the seed', async t => {
  const {attempt, input} = await setup(t);
  const procedure = await prepareFixture(attempt);
  assert.equal(await readFile(join(procedure, '../resource.txt'), 'utf8'), 'relative resource');
  await writeFile(join(attempt.fixture, 'greet.mjs'), "export const greet = (name) => `Hello, ${name || 'world'}!`;\n");
  const second = await Attempt.create(input); await prepareFixture(second);
  assert.match(await readFile(join(second.fixture, 'greet.mjs'), 'utf8'), /Hello \$\{name\}\./);
  assert.deepEqual(await hashes(join(second.fixture, '.bb/skills/openspec-verify-change')), (attempt.result.procedure as {hashes: unknown}).hashes);
});

test('external checks catch weakened tests and optional artifacts independently of a clean report', async t => {
  const {attempt} = await setup(t); await prepareFixture(attempt);
  await writeFile(join(attempt.fixture, 'greet.test.mjs'), '// weakened fixture test\n');
  attempt.result.terminal = {status: 'clean'};
  await independentChecks(attempt);
  assert.equal(attempt.result.assertions.find(c => c.name === 'Independent greeting behavior')?.passed, false);
  assert.equal(attempt.result.assertions.find(c => c.name === 'Fixture tests')?.passed, true);
  attempt.result.assertions = [];
  await writeFile(join(attempt.fixture, 'greet.mjs'), "export const greet = (name) => `Hello, ${name || 'world'}!`;\n");
  await independentChecks(attempt);
  assert(attempt.result.assertions.every(c => c.passed));
  await writeFile(join(attempt.fixture, 'openspec/changes/add-greeting/design.md'), 'invented design');
  await independentChecks(attempt);
  assert.equal(attempt.result.assertions.at(-1)?.passed, false);
});

test('an attempt creates a missing output directory', async t => {
  const {input, root} = await setup(t);
  const attempt = await Attempt.create({...input, output: join(root, 'missing/nested')});
  assert(attempt.root.startsWith(join(await realpath(root), 'missing/nested')));
});

test('options reject missing models, invalid bounds and unsupported permission modes before host mutation', () => {
  const args = ['--scenario', 'stop', '--provider', 'fake', '--model', 'fake', '--procedure', '/installed/SKILL.md', '--permission-mode', 'auto'];
  assert(options('bb', args));
  assert.throws(() => options('bb', args.filter((_, i) => i !== 4 && i !== 5)), /model/);
  assert.throws(() => options('bb', [...args, '--timeout', 'Infinity']), /finite/);
  assert.throws(() => options('bb', args.map(v => v === 'auto' ? 'accept-edits' : v)), /permission-mode/);
  assert.equal(options('bb', ['--help']), undefined);
});

test('pagination collects all records and fails on stalled or incomplete pages', async () => {
  const records = await collectPages<number, string>(async cursor => cursor ? {items: [3], next: null} : {items: [1, 2], next: 'next'});
  assert.deepEqual(records, [1, 2, 3]);
  await assert.rejects(collectPages(async () => ({items: [], next: 'same'})), /cursor/);
  await assert.rejects(collectPages(async () => ({items: undefined as unknown as number[]})), /incomplete/);
});

test('a lost start is not rerun and cleanup failure retains evidence with a nonzero exit', async t => {
  const {attempt} = await setup(t);
  let starts = 0, cleanup = 0;
  const code = await lifecycle(attempt, async () => {
    attempt.result.originId = 'known-origin'; attempt.result.stage = 'execution'; starts++;
    throw new Error('lost start response');
  }, async () => { cleanup++; attempt.result.cleanup.fallback = true; throw new Error('worker still active'); });
  assert.equal(starts, 1); assert.equal(cleanup, 1); assert.equal(code, 1);
  const result = JSON.parse(await readFile(join(attempt.evidence, 'result.json'), 'utf8'));
  assert.equal(result.originId, 'known-origin'); assert.equal(result.cleanup.confirmed, false);
  assert.equal(result.cleanup.fallback, true); assert.equal(result.stage, 'cleanup');
});

test('marked native notices distinguish start outcomes and terminal statuses, including queued copies', () => {
  const start = {id: 'start', type: 'synthetic', metadata: {openspecLoopNotice: true}, text: 'Notice\n{"outcome":"started","runId":"r"}'};
  const terminal = {id: 'end', type: 'synthetic', metadata: {openspecLoopNotice: true}, text: 'Notice\n{"status":"clean","runId":"r"}'};
  const queued = {id: 'end', type: 'synthetic', payload: terminal};
  assert.equal(notices([start], [queued]).find(n => n.value.status)?.queued, true);
  const combined = notices([start, terminal], [queued]);
  assert.equal(combined.length, 2); assert.equal(combined.find(n => n.value.status)?.queued, false);
  assert.equal(combined.find(n => n.value.outcome)?.value.outcome, 'started');
  assert.throws(() => notices([{...terminal, text: 'truncated'}], []), /incomplete/);
});

test('successful assertions require confirmed cleanup, and evidence redacts authentication', async t => {
  const {attempt} = await setup(t);
  const code = await lifecycle(attempt, async () => {
    attempt.check('Scenario', true); attempt.result.hostInfo = {version: 'fake', authorization: 'secret'};
  }, async () => { attempt.result.cleanup.confirmed = true; });
  assert.equal(code, 0);
  const saved = await readFile(join(attempt.evidence, 'result.json'), 'utf8');
  assert(!saved.includes('secret')); assert.match(saved, /redacted/);
});

test('deadline and interruption enter independent cleanup and never turn failure into a pass', async t => {
  const {attempt} = await setup(t); attempt.options.timeout = 10;
  let cleaned = false;
  const code = await lifecycle(attempt, signal => new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('unexpected timer')), 1000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, {once: true});
  }), async signal => { assert(!signal.aborted); cleaned = true; attempt.result.cleanup.confirmed = true; });
  assert.equal(code, 1); assert(cleaned);
});
