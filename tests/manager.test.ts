import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunManager } from '../src/manager.js';
import { createAgent, type TrackWorker } from '../src/runner.js';
import { deferred, fakeClient, until } from './fake-client.js';

const model = {providerID: 'fake', id: 'test'};
function setup(options: Parameters<typeof fakeClient>[0] = {hold: true}) {
  const notices: {sessionId: string; result: Record<string, unknown>}[] = [];
  const manager = new RunManager(async (sessionId, result) => {notices.push({sessionId, result});});
  const fake = fakeClient(options);
  // One worker call, standing in for the loop script.
  const execute = (signal: AbortSignal, runId: string, trackWorker: TrackWorker) =>
    createAgent({adapter: fake.adapter, project: '/p', runId, model, signal, trackWorker, pollMs: 1})('verify', {phase: 'Verify'})
      .then(report => ({status: 'clean', report}));
  return {manager, notices, execute, ...fake};
}

test('start refuses a second run in the same checkout', async () => {
  const {manager, execute, stats} = setup();
  assert.equal(manager.start('/p', 'origin', execute).outcome, 'started');
  assert.throws(() => manager.start('/p', 'origin', execute), /already running/);
  await until(() => stats.prompts === 1);
  await manager.close();
});

test('stop interrupts the active worker and the run ends stopped', async () => {
  const {manager, notices, execute, stats} = setup();
  const {runId} = manager.start('/p', 'origin', execute);
  await until(() => stats.prompts === 1);
  assert.deepEqual(await manager.stop('/p'), {outcome: 'stopped', runId, originSessionId: 'origin'});
  assert.equal(stats.interrupts, 1);
  assert.deepEqual(notices, [{sessionId: 'origin', result: {runId, status: 'stopped', reason: 'Stopped by user'}}]);
  assert.equal((await manager.stop('/p')).outcome, 'not_running');
});

test('plugin dispose aborts every run and interrupts its worker before resolving', async () => {
  const {manager, notices, execute, stats} = setup();
  manager.start('/p', 'origin', execute);
  manager.start('/q', 'origin', execute);
  await until(() => stats.prompts === 2);
  await manager.close();
  assert.equal(stats.interrupts, 2);
  assert.equal(notices.length, 0, 'an unloaded plugin sends no notice');
  assert.throws(() => manager.start('/p', 'origin', execute), /unloading/);
});

test('one notice is sent per run that ends, with its result or failure', async () => {
  const {manager, notices, execute} = setup({replies: ['all good\nVERDICT: CLEAN']});
  const {runId} = manager.start('/p', 'origin', execute);
  await until(() => notices.length === 1);
  assert.deepEqual(notices[0], {sessionId: 'origin', result: {runId, status: 'clean', report: 'all good\nVERDICT: CLEAN'}});
  const failed = manager.start('/p', 'origin', async () => {throw new Error('worker failed');});
  await until(() => notices.length === 2);
  assert.deepEqual(notices[1]!.result, {runId: failed.runId, status: 'failed', reason: 'worker failed'});
  await manager.close();
  assert.equal(notices.length, 2);
});

for (const failure of ['false', 'throws'] as const) {
  test(`cleanup ${failure} retains ownership until a later explicit stop succeeds`, async () => {
    const {manager, notices, execute, adapter, stats} = setup();
    const interrupt = adapter.interrupt.bind(adapter);
    let attempts = 0, fail = true;
    adapter.interrupt = async a => {
      attempts++;
      if (fail) {
        if (failure === 'throws') throw new Error('interrupt request timed out');
        return false;
      }
      return interrupt(a);
    };
    const {runId} = manager.start('/p', 'origin', execute);
    await until(() => stats.prompts === 1);
    const first = await manager.stop('/p');
    assert.equal(first.outcome, 'failed');
    assert.equal(first.originSessionId, 'origin', 'the first stop is answered by its run notice');
    assert.equal(notices[0]!.result.status, 'failed');
    assert.match(String(first.reason), new RegExp(stats.created[0].id));
    assert.match(String(first.reason), /Checkout remains reserved/);
    assert.throws(() => manager.start('/p', 'origin', execute), /reserved for worker/);
    assert.equal(attempts, 1, 'failure does not automatically retry');
    const second = await manager.stop('/p');
    assert.equal(second.outcome, 'failed');
    assert.equal(second.originSessionId, undefined, 'a retry needs its own reply');
    fail = false;
    assert.deepEqual(await manager.stop('/p'), {outcome: 'stopped', runId});
    assert.equal(notices.length, 1, 'cleanup does not rewrite the terminal result');
    assert.equal(attempts, 3);
    assert.equal(stats.prompts, 1, 'cleanup never submits a prompt');
    assert.equal((await manager.stop('/p')).outcome, 'not_running');
    manager.start('/p', 'new-origin', async () => ({status: 'clean'}));
    await until(() => notices.length === 2);
    await manager.close();
  });
}

test('an observation failure preserves its cause and reservation when cleanup fails', async () => {
  const {manager, notices, execute, adapter, stats} = setup();
  adapter.observe = async () => {throw new Error('status request timed out');};
  const interrupt = adapter.interrupt.bind(adapter);
  adapter.interrupt = async () => false;
  manager.start('/p', 'origin', execute);
  await until(() => notices.length === 1);
  assert.match(String(notices[0]!.result.reason), /status request timed out.*cleanup failed/s);
  assert.equal(stats.created.length, 1);
  assert.throws(() => manager.start('/p', 'origin', execute), /reserved for worker/);
  adapter.interrupt = interrupt;
  assert.equal((await manager.stop('/p')).outcome, 'stopped');
  await manager.close();
});

test('concurrent stop and close share the retained worker cleanup attempt', async () => {
  const {manager, notices, execute, adapter, stats} = setup();
  const interrupt = adapter.interrupt.bind(adapter);
  adapter.interrupt = async () => false;
  manager.start('/p', 'origin', execute);
  await until(() => stats.prompts === 1);
  await manager.stop('/p');
  const gate = deferred();
  let attempts = 0;
  adapter.interrupt = async a => {attempts++; await gate.promise; return interrupt(a);};
  const first = manager.stop('/p'), second = manager.stop('/p');
  const closing = manager.close();
  assert.equal(first, second);
  assert.equal(attempts, 1);
  gate.resolve();
  assert.equal((await first).outcome, 'stopped');
  await second;
  await closing;
  assert.equal(attempts, 1);
  assert.equal(notices.length, 1);
});

test('stop during final observation agrees with the run notice; completed runs stay completed', async () => {
  const {manager, notices, execute, adapter} = setup({replies: ['VERDICT: CLEAN']});
  const gate = deferred(), observe = adapter.observe.bind(adapter);
  let observing = false;
  adapter.observe = async a => {observing = true; await gate.promise; return observe(a);};
  manager.start('/p', 'origin', execute);
  await until(() => observing);
  const stopped = manager.stop('/p');
  gate.resolve();
  assert.equal((await stopped).outcome, 'stopped');
  assert.equal(notices[0]!.result.status, 'stopped');
  adapter.observe = observe;
  manager.start('/p', 'origin', execute);
  await until(() => notices.length === 2);
  assert.equal(notices[1]!.result.status, 'clean');
  assert.equal((await manager.stop('/p')).outcome, 'not_running');
  await manager.close();
});

test('cancellation before terminal result commitment wins even after execution returns', async () => {
  const notices: Record<string, unknown>[] = [], gate = deferred();
  const manager = new RunManager(async (_session, result) => {notices.push(result);});
  manager.start('/p', 'origin', async () => {await gate.promise; return {status: 'clean'};});
  const stopped = manager.stop('/p');
  gate.resolve();
  assert.equal((await stopped).outcome, 'stopped');
  assert.equal(notices[0]!.status, 'stopped');
});

test('close retries workers retained after execution has failed', async () => {
  const {manager, notices, execute, adapter} = setup();
  adapter.observe = async () => {throw new Error('status request failed');};
  const interrupt = adapter.interrupt.bind(adapter);
  adapter.interrupt = async () => false;
  manager.start('/p', 'origin', execute);
  await until(() => notices.length === 1);
  await assert.rejects(manager.close(), /cleanup failed/);
  assert.throws(() => manager.start('/p', 'origin', execute), /unloading/);
  adapter.interrupt = interrupt;
  await manager.close();
  await manager.close();
  assert.equal(notices.length, 1);
});

test('close waits for a pending failure notice before retry reporting or disposal', async () => {
  const fake = fakeClient({hold: true}), gate = deferred();
  const interrupt = fake.adapter.interrupt.bind(fake.adapter);
  let notifications = 0, closingFinished = false;
  fake.adapter.observe = async () => {throw new Error('status request failed');};
  fake.adapter.interrupt = async () => false;
  const manager = new RunManager(async () => {notifications++; await gate.promise;});
  manager.start('/p', 'origin', (signal, runId, trackWorker) =>
    createAgent({adapter: fake.adapter, project: '/p', runId, model, signal, trackWorker})('verify', {phase: 'Verify'}));
  await until(() => notifications === 1);
  const closing = manager.close().then(() => undefined, error => error).finally(() => {closingFinished = true;});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closingFinished, false, 'unload cannot outrun an already pending notice');
  gate.resolve();
  assert.match(String(await closing), /cleanup failed/);
  await manager.reportRetainedFailures();
  assert.equal(notifications, 1);
  fake.adapter.interrupt = interrupt;
  await manager.close();
});

test('undelivered results release reservations, remain retrievable, and retry once', async () => {
  let fail = true;
  const logs: string[] = [], notices: Record<string, unknown>[] = [];
  const registry = {owners: new Map(), pending: new Map()};
  const manager = new RunManager(async (_session, result) => {
    if (fail) throw new Error('notice endpoint unavailable');
    notices.push(result);
  }, registry, message => logs.push(message));
  const first = manager.start('/p', 'origin', async () => ({status: 'clean', report: 'verified'}));
  await until(() => logs.length === 1);
  assert.match(logs[0]!, new RegExp(`${first.runId}.*notice endpoint unavailable`));
  assert.equal((await manager.stop('/p')).outcome, 'not_running');
  const second = manager.start('/p', 'origin', async () => ({status: 'failed', reason: 'worker failed'}));
  await until(() => logs.length === 2);
  assert.deepEqual(await manager.retryReports('/other'), {outcome: 'reports', results: []});
  const failed = await manager.retryReports('/p');
  assert.deepEqual(failed.results.map(entry => [entry.result?.runId, entry.delivered]), [[first.runId, false], [second.runId, false]]);
  fail = false;
  const recovered = await manager.retryReports('/p');
  assert.deepEqual(recovered.results.map(entry => entry.delivered), [true, true]);
  assert.deepEqual(notices.map(result => result.runId), [first.runId, second.runId]);
  assert.deepEqual(await manager.retryReports('/p'), {outcome: 'reports', results: []});
  await manager.close();
});

test('a result left by unload is recovered and delivered by another instance', async () => {
  const registry = {owners: new Map(), pending: new Map()};
  const unloaded: Record<string, unknown>[] = [], recovered: Record<string, unknown>[] = [];
  const a = new RunManager(async (_session, result) => {unloaded.push(result);}, registry);
  const b = new RunManager(async (_session, result) => {recovered.push(result);}, registry);
  const fake = fakeClient({hold: true});
  const {runId} = a.start('/p', 'origin', (signal, runId, trackWorker) =>
    createAgent({adapter: fake.adapter, project: '/p', runId, model, signal, trackWorker, pollMs: 1})('verify', {phase: 'Verify'}));
  await until(() => fake.stats.prompts === 1);
  await a.close();
  assert.equal(unloaded.length, 0, 'the unloading instance sends no notice');
  const report = await b.retryReports('/p');
  assert.deepEqual(report.results.map(entry => [entry.result?.runId, entry.result?.status, entry.delivered]), [[runId, 'stopped', true]]);
  assert.deepEqual(recovered.map(result => result.runId), [runId]);
  assert.deepEqual(await b.retryReports('/p'), {outcome: 'reports', results: []});
  await b.close();
});
