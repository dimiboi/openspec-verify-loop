import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/runner.js';
import { workerPermissions } from '../src/workers.js';
import { fakeClient, until, type FakeOptions } from './fake-client.js';

const model = {providerID: 'fake', id: 'test', variant: 'high'};
function agentWith(options: FakeOptions = {}, signal = new AbortController().signal) {
  const fake = fakeClient(options);
  return {...fake, agent: createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model, signal, pollMs: 1})};
}

test('a worker prompt is submitted exactly once and its final text returned', async () => {
  const {agent, stats} = agentWith({replies: ['report\nVERDICT: CLEAN']});
  assert.equal(await agent('verify', {phase: 'Verify'}), 'report\nVERDICT: CLEAN');
  assert.equal(stats.prompts, 1);
  assert.equal(stats.created[0].model, model);
  assert.equal(stats.created[0].agent, 'build');
});

test('a lost submission response is reconciled without resubmitting', async () => {
  const {agent, stats} = agentWith({promptFails: 'lost', replies: ['done']});
  assert.equal(await agent('fix', {phase: 'Fix'}), 'done');
  assert.equal(stats.prompts, 1);
});

test('an invisible submission fails the call with no second prompt', async () => {
  const {agent, stats} = agentWith({promptFails: 'invisible'});
  await assert.rejects(agent('verify', {phase: 'Verify'}), /no automatic resubmission/);
  assert.equal(stats.prompts, 1);
});

test('a permission request interrupts the worker and names its session', async () => {
  const {agent, stats} = agentWith({hold: true, permissions: [{id: 'perm_1', action: 'shell', resources: ['npm test']}]});
  await assert.rejects(agent('verify', {phase: 'Verify'}), error => {
    assert.match((error as Error).message, new RegExp(`${stats.created[0].id} is waiting for input.*perm_1`));
    assert.equal((error as {outcome?: string}).outcome, 'blocked');
    return true;
  });
  assert.equal(stats.interrupts, 1);
});

test('abort interrupts the running session and rejects the call', async () => {
  const abort = new AbortController();
  const {agent, stats} = agentWith({hold: true}, abort.signal);
  const pending = agent('fix', {phase: 'Fix'});
  await until(() => stats.prompts === 1);
  abort.abort(new Error('Stopped by user'));
  await assert.rejects(pending, /Stopped by user/);
  assert.equal(stats.interrupts, 1);
});

test('verifier sessions get verifier permissions; fixer sessions may edit', async () => {
  const {agent, stats} = agentWith();
  await agent('verify', {phase: 'Verify'});
  await agent('fix', {phase: 'Fix'});
  assert.deepEqual(stats.created[0].permissions, workerPermissions('verifier'));
  assert.deepEqual(stats.created[1].permissions, workerPermissions('fixer'));
  assert.notEqual(stats.created[0].id, stats.created[1].id, 'every call uses a fresh session');
  assert.equal(stats.created[0].metadata.openspecVerifyLoop, 'run_1', 'workers are marked so the context hook hides the loop tool');
});
