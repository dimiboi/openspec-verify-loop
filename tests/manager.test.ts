import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunManager } from '../src/manager.js';
import { createAgent } from '../src/runner.js';
import { fakeClient, until } from './fake-client.js';

const model = {providerID: 'fake', id: 'test'};
function setup(options: Parameters<typeof fakeClient>[0] = {hold: true}) {
  const notices: {sessionId: string; result: Record<string, unknown>}[] = [];
  const manager = new RunManager(async (sessionId, result) => {notices.push({sessionId, result});});
  const fake = fakeClient(options);
  // One worker call, standing in for the loop script.
  const execute = (signal: AbortSignal, runId: string) =>
    createAgent({adapter: fake.adapter, project: '/p', runId, model, signal, pollMs: 1})('verify', {phase: 'Verify'})
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
