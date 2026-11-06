import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, type WorkerCleanup } from '../src/runner.js';
import { workerPermissions } from '../src/workers.js';
import { deferred, fakeClient, until, type FakeOptions } from './fake-client.js';

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
  await assert.rejects(agent('verify', {phase: 'Verify'}), /no automatic resubmission.*Submission error: connection reset/);
  assert.equal(stats.prompts, 1);
  assert.equal(stats.interrupts, 1, 'uncertain admission is cleaned up without a second submission');
});

test('a failed read before submission keeps its cause and sends no prompt', async () => {
  const fake = fakeClient();
  const client = fake.adapter.client as any, list = client.session.inbox.list;
  let failures = 1;
  client.session.inbox.list = async (...args: unknown[]) => {
    if (failures-- > 0) throw new Error('inbox request timed out');
    return list(...args);
  };
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model, signal: new AbortController().signal, pollMs: 1});
  await assert.rejects(agent('verify', {phase: 'Verify'}), /inbox request timed out/);
  assert.equal(fake.stats.prompts, 0);
});

test('a lost creation response is reconciled by the assigned identity without a second session', async () => {
  const fake = fakeClient({replies: ['done']});
  const client = fake.adapter.client as any, create = client.session.create;
  client.session.create = async (input: unknown) => {await create(input); throw new Error('create response lost');};
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model, signal: new AbortController().signal, pollMs: 1});
  assert.equal(await agent('fix', {phase: 'Fix'}), 'done');
  assert.deepEqual([fake.stats.created.length, fake.stats.prompts], [1, 1]);
});

test('a failed creation with no session fails with its error and sends no prompt', async () => {
  const fake = fakeClient();
  (fake.adapter.client as any).session.create = async () => {throw new Error('create rejected');};
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model, signal: new AbortController().signal, pollMs: 1});
  await assert.rejects(agent('verify', {phase: 'Verify'}), /create rejected/);
  assert.equal(fake.stats.prompts, 0);
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

test('a failed observation interrupts the worker and preserves the original error', async () => {
  const fake = fakeClient({hold: true});
  let worker: WorkerCleanup | undefined;
  fake.adapter.observe = async () => {throw new Error('status request timed out');};
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model,
    signal: new AbortController().signal, trackWorker: value => {worker = value;}});
  await assert.rejects(agent('fix', {phase: 'Fix'}), /status request timed out/);
  assert.equal(fake.stats.prompts, 1);
  assert.equal(fake.stats.created.length, 1);
  assert.equal(fake.stats.interrupts, 1);
  assert.equal(worker, undefined, 'only confirmed cleanup releases the handle');
});

test('a permission wait with unconfirmed cleanup retains the worker and both failure causes', async () => {
  const fake = fakeClient({hold: true, permissions: [{id: 'perm_1', action: 'shell', resources: ['check']}]});
  let worker: WorkerCleanup | undefined;
  fake.adapter.interrupt = async () => false;
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model,
    signal: new AbortController().signal, trackWorker: value => {worker = value;}});
  await assert.rejects(agent('fix', {phase: 'Fix'}), error => {
    assert.equal((error as {outcome: string}).outcome, 'failed');
    assert.match((error as Error).message, /perm_1.*cleanup failed.*Checkout remains reserved/s);
    assert.match((error as Error).message, new RegExp(fake.stats.created[0].id));
    return true;
  });
  assert.equal(worker?.sessionId, fake.stats.created[0].id);
  assert.equal(fake.stats.prompts, 1);
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

test('stop during session creation waits for creation and sends no prompt', async () => {
  const abort = new AbortController(), gate = deferred();
  const fake = fakeClient({hold: true});
  const ensureSession = fake.adapter.ensureSession.bind(fake.adapter);
  fake.adapter.ensureSession = async a => {await ensureSession(a); await gate.promise;};
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model, signal: abort.signal});
  const pending = agent('fix', {phase: 'Fix'});
  await until(() => fake.stats.created.length === 1);
  abort.abort(new Error('Stopped by user'));
  assert.equal(fake.stats.prompts, 0);
  assert.equal(fake.stats.interrupts, 0, 'creation is still being reconciled');
  gate.resolve();
  await assert.rejects(pending, /Stopped by user/);
  assert.equal(fake.stats.prompts, 0);
  assert.equal(fake.stats.interrupts, 1);
});

test('stop during final observation discards the reply after confirming the worker inactive', async () => {
  const abort = new AbortController(), gate = deferred();
  const fake = fakeClient();
  const observe = fake.adapter.observe.bind(fake.adapter);
  let observing = false;
  fake.adapter.observe = async a => {observing = true; await gate.promise; return observe(a);};
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model, signal: abort.signal});
  const pending = agent('verify', {phase: 'Verify'});
  await until(() => observing);
  abort.abort(new Error('Stopped by user'));
  gate.resolve();
  await assert.rejects(pending, /Stopped by user/);
  assert.equal(fake.stats.interrupts, 0, 'a terminal observation already confirms inactivity');
});

test('stop during a lost admission response reconciles before cleanup without resubmission', async () => {
  const abort = new AbortController(), gate = deferred();
  const fake = fakeClient({hold: true, promptFails: 'lost'});
  const ensurePrompt = fake.adapter.ensurePrompt.bind(fake.adapter);
  let uncertain = false, reconciliations = 0;
  fake.adapter.ensurePrompt = async (a, submit) => {
    if (submit === false) {uncertain = true; reconciliations++; await gate.promise;}
    return ensurePrompt(a, submit);
  };
  const agent = createAgent({adapter: fake.adapter, project: '/p', runId: 'run_1', model, signal: abort.signal});
  const pending = agent('fix', {phase: 'Fix'});
  await until(() => uncertain);
  abort.abort(new Error('Stopped by user'));
  assert.equal(fake.stats.interrupts, 0, 'admission must settle before interruption can release ownership');
  gate.resolve();
  await assert.rejects(pending, /Stopped by user/);
  assert.equal(fake.stats.prompts, 1);
  assert.equal(reconciliations, 1);
  assert.equal(fake.stats.interrupts, 1);
});
