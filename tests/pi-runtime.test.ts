import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import type { Storage } from '@earendil-works/pi-durable';
import { loadScript } from '../src/loop.js';
import { hash, modelsFor, type PiSettings } from '../src/pi-context.js';
import { PiRecords, PiRuntime, readRecords, selectRun } from '../src/pi-runtime.js';
import { answer, fakeRegistry, model } from './pi-fakes.js';

export const CLEAN = '## Verification Report: add-export\nAll checks passed.\nVERDICT: CLEAN';
export const ISSUES = '## Verification Report: add-export\n1 warning(s): fix the greeting.\nVERDICT: ISSUES';

async function setup(t: {after: (fn: () => Promise<void>) => void}) {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-loop-runtime-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  execFileSync('git', ['init', '-q', temporary]);
  const checkout = await realpath(temporary);
  const procedurePath = join(checkout, 'SKILL.md'); await writeFile(procedurePath, 'verify');
  const directory = join(checkout, '.git', 'pi-test-state');
  const settings: PiSettings = {checkout, directory: checkout, origin: 'origin', model: {provider: model.provider, modelId: model.id},
    thinkingLevel: 'high', procedurePath, procedureHash: hash('verify'), instructions: 'Follow the project rules.'};
  return {checkout, directory, settings, source: await loadScript()};
}

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Timed out waiting for fake worker');
}

test('Pi runs the shared loop with fresh role tools, inherited settings and complete reports', async t => {
  const options = await setup(t);
  const fake = fakeRegistry([ISSUES, 'Fixed the greeting.', CLEAN]);
  const models = await modelsFor(fake.registry, options.settings.model, 'high');
  const runtime = await PiRuntime.open({...options, models});
  t.after(() => runtime.close(false));
  const run = await runtime.create(options.settings, {change: 'add-export', maxRounds: 2});
  assert.equal(fake.requests.length, 0, 'creation is inert');
  runtime.start();
  const finished = await runtime.wait(run.id);
  assert.equal(finished.result?.status, 'clean', JSON.stringify(finished));
  assert.equal(new Set(finished.calls.map(call => call.conversation)).size, 3);
  assert.deepEqual(finished.calls.map(call => call.role), ['verifier', 'fixer', 'verifier']);
  for (const [i, request] of fake.requests.entries()) {
    const names = request.context.messages.flatMap(message => message.role === 'system' ? message.toolsAdded ?? [] : []).map(tool => tool.name).sort();
    assert.deepEqual(names, i === 1 ? ['bash', 'edit', 'read', 'write'] : ['bash', 'read']);
    assert.match(JSON.stringify(request.context.messages), /Follow the project rules/);
    assert.equal(request.options?.reasoning, 'high');
  }
  assert.match(finished.calls[1]!.prompt, new RegExp(ISSUES.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const {runs} = await readRecords(options.directory);
  assert.equal(selectRun(runs, run.id).calls[0]!.reply, ISSUES);
  assert.equal(selectRun(runs, undefined, true).id, run.id);
  assert.throws(() => selectRun(runs, 'run_123'), /Unknown run/);
});

test('Pi reopens inertly and explicitly resumes a pending call without repeating completed workers', async t => {
  const options = await setup(t);
  const fake = fakeRegistry([ISSUES, async (_ctx, opts) => new Promise(resolve => {
    opts?.signal?.addEventListener('abort', () => resolve(answer('interrupted', 'aborted')), {once: true});
  })]);
  const runtime = await PiRuntime.open({...options, models: await modelsFor(fake.registry, options.settings.model, 'high')});
  const run = await runtime.create(options.settings, {change: 'add-export', maxRounds: 2});
  runtime.start();
  await until(async () => fake.requests.length === 2 && (await runtime.get(run.id)).calls[1]?.submission !== null);
  const before = await runtime.get(run.id);
  await runtime.close();
  assert.equal((await readRecords(options.directory)).runs[0]!.state, 'interrupted');
  const fake2 = fakeRegistry(['Fixed.', CLEAN]);
  const reopened = await PiRuntime.open({...options, models: await modelsFor(fake2.registry, options.settings.model, 'high')});
  t.after(() => reopened.close(false));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(fake2.requests.length, 0, 'opening and reading never schedules work');
  await reopened.resume(run.id);
  const finished = await reopened.wait(run.id);
  assert.equal(finished.result?.status, 'clean', JSON.stringify(finished));
  assert.equal(fake2.requests.length, 2, 'only pending fixer and new verifier execute');
  assert.equal(finished.calls[0]!.conversation, before.calls[0]!.conversation);
  assert.equal(finished.calls[1]!.submission, before.calls[1]!.submission);
  assert.equal(finished.maxAgentCalls, before.maxAgentCalls);
  assert.equal(finished.calls.length, 3);
});

test('Pi rejects truncated worker responses and starts no fixer', async t => {
  const options = await setup(t);
  const fake = fakeRegistry([async () => answer(CLEAN, 'length')]);
  const runtime = await PiRuntime.open({...options, models: await modelsFor(fake.registry, options.settings.model, 'high')});
  t.after(() => runtime.close(false));
  const run = await runtime.create(options.settings, {maxRounds: 2}); runtime.start();
  const finished = await runtime.wait(run.id);
  assert.equal(finished.result?.status, 'failed');
  assert.match(finished.result!.reason, /complete final response/);
  assert.equal(fake.requests.length, 1);
});

test('Pi resume after a completed fix only executes its pending verifier', async t => {
  const options = await setup(t);
  const fake = fakeRegistry([ISSUES, 'Fixed.', async (_ctx, opts) => new Promise(resolve => {
    opts?.signal?.addEventListener('abort', () => resolve(answer('interrupted', 'aborted')), {once: true});
  })]);
  const first = await PiRuntime.open({...options, models: await modelsFor(fake.registry, options.settings.model, 'high')});
  const run = await first.create(options.settings, {maxRounds: 2}); first.start();
  await until(async () => fake.requests.length === 3);
  const before = await first.get(run.id); await first.close();
  const second = fakeRegistry([CLEAN]);
  const next = await PiRuntime.open({...options, models: await modelsFor(second.registry, options.settings.model, 'high')});
  t.after(() => next.close(false));
  await next.resume(run.id);
  const result = await next.wait(run.id);
  assert.equal(result.result?.status, 'clean'); assert.equal(second.requests.length, 1);
  assert.deepEqual(result.calls.map(call => call.conversation), before.calls.map(call => call.conversation));
});

test('Pi replay rejects a changed saved prompt without scheduling pending work', async t => {
  const options = await setup(t);
  const fake = fakeRegistry([ISSUES, async (_ctx, opts) => new Promise(resolve => {
    opts?.signal?.addEventListener('abort', () => resolve(answer('interrupted', 'aborted')), {once: true});
  })]);
  const first = await PiRuntime.open({...options, models: await modelsFor(fake.registry, options.settings.model, 'high')});
  const run = await first.create(options.settings, {maxRounds: 2}); first.start();
  await until(async () => fake.requests.length === 2); await first.close();
  const fake2 = fakeRegistry([CLEAN]);
  const reopened = await PiRuntime.open({...options, models: await modelsFor(fake2.registry, options.settings.model, 'high')});
  t.after(() => reopened.close(false));
  await reopened.harness.commit(async tx => {
    const book = await tx.doc(PiRecords); book.runs[0]!.calls[0]!.prompt = 'changed';
  }, context);
  await assert.rejects(reopened.resume(run.id), /replay mismatch/);
  assert.equal(fake2.requests.length, 0);
  assert.equal((await reopened.get(run.id)).state, 'interrupted');
});

test('Pi report reads records read-only and compatibility checks preserve saved records', async t => {
  const options = await setup(t);
  const fake = fakeRegistry();
  const runtime = await PiRuntime.open({...options, models: await modelsFor(fake.registry, options.settings.model, 'high')});
  const run = await runtime.create(options.settings, {maxRounds: 2});
  await runtime.close();
  const mainPath = join(options.directory, 'store/main.jsonl');
  const before = await readFile(mainPath, 'utf8');
  assert.equal((await readRecords(options.directory)).runs[0]!.id, run.id);
  assert.equal(await readFile(mainPath, 'utf8'), before);
  const reopened = await PiRuntime.open({...options, models: await modelsFor(fake.registry, options.settings.model, 'high')});
  t.after(() => reopened.close(false));
  await writeFile(options.settings.procedurePath, 'changed');
  await assert.rejects(reopened.resume(run.id), /procedure changed/);
  assert.equal(fake.requests.length, 0);
  assert.equal((await reopened.get(run.id)).state, 'interrupted');
  await reopened.harness.commit(async tx => {
    const records = await tx.doc(PiRecords); records.runs[0]!.loopHash = 'different';
  }, context);
  await assert.rejects(reopened.resume(run.id), /incompatible loop/);
});

for (const boundary of ['before', 'after']) test(`Pi admission failure ${boundary} the atomic commit never duplicates a prompt`, async t => {
  const options = await setup(t);
  const fake = fakeRegistry([CLEAN]);
  const models = await modelsFor(fake.registry, options.settings.model, 'high');
  const storage = await openNodeJsonlStorage(join(options.directory, 'store'), context, {fsync: true});
  let injected = false;
  const fault = new Proxy(storage, {get: (target, key) => {
    if (key === 'commit') return (async (batches, receive, ctx) => {
      if (!injected && batches.some(batch => batch.some(write => write.type === 'submission'))) {
        injected = true;
        if (boundary === 'after') await target.commit(batches, receive, ctx);
        throw new Error('Injected lost admission outcome');
      }
      return target.commit(batches, receive, ctx);
    }) satisfies Storage['commit'];
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const runtime = await PiRuntime.open({...options, models, storage: fault});
  const run = await runtime.create(options.settings, {maxRounds: 1}); runtime.start();
  await runtime.harness.closed;
  const reopened = await PiRuntime.open({...options, models});
  t.after(() => reopened.close(false));
  await reopened.resume(run.id);
  const finished = await reopened.wait(run.id);
  assert(injected);
  assert.equal(finished.calls.length, 1);
  if (boundary === 'before') {
    assert.equal(finished.result?.status, 'failed');
    assert.match(finished.result!.reason, /admission is uncertain/);
    assert.equal(fake.requests.length, 0);
  } else {
    assert.equal(finished.result?.status, 'clean');
    assert.equal(fake.requests.length, 1);
    assert.equal(finished.calls[0]!.admission, 'admitted');
  }
});

test('Pi stop after restart aborts saved work without executing a worker', async t => {
  const options = await setup(t);
  const fake = fakeRegistry();
  const models = await modelsFor(fake.registry, options.settings.model, 'high');
  const runtime = await PiRuntime.open({...options, models});
  const run = await runtime.create(options.settings, {maxRounds: 2}); await runtime.close();
  const reopened = await PiRuntime.open({...options, models}); t.after(() => reopened.close(false));
  const stopped = await reopened.stop(run.id);
  assert.equal(stopped.state, 'terminal'); assert.equal(stopped.result?.status, 'stopped');
  assert.equal(fake.requests.length, 0);
  await assert.rejects(reopened.resume(run.id), /terminal/);
});

test('Pi stop during a worker cancels it and prevents the following worker', async t => {
  const options = await setup(t);
  const fake = fakeRegistry([ISSUES, async (_ctx, opts) => new Promise(resolve => {
    opts?.signal?.addEventListener('abort', () => resolve(answer('aborted', 'aborted')), {once: true});
  })]);
  const runtime = await PiRuntime.open({...options, models: await modelsFor(fake.registry, options.settings.model, 'high')});
  t.after(() => runtime.close(false));
  const run = await runtime.create(options.settings, {maxRounds: 3}); runtime.start();
  await until(async () => fake.requests.length === 2);
  const stopped = await runtime.stop(run.id);
  assert.equal(stopped.result?.status, 'stopped');
  assert.equal(fake.requests.length, 2);
});
