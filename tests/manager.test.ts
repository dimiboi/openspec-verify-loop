import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, FakeAdapter } from './fixtures.js';
import { RunManager } from '../src/manager.js';
import { configSchema } from '../src/config.js';
import { delay } from '../src/util.js';

async function dispatched(adapter: FakeAdapter) {
  for (let i = 0; i < 4000 && !adapter.seen.length; i++) await delay(5);
  assert(adapter.seen.length, 'worker was not dispatched');
}
test('manager owns lifecycle, responds to stop, and recovers safely across generations in the same process', async t => {
  const f = await fixture(); t.after(() => rm(f.base, {recursive: true, force: true}));
  const options = {lockRoot: f.lockRoot, pollMs: 1, stopWaitMs: 5};
  const config = configSchema.parse({stateDir: f.stateDir});
  await t.test('start is acknowledged before worker completion and stop uses the owning task', async () => {
    const manager = new RunManager(options);
    const adapter = new FakeAdapter(() => ({status: 'running'}));
    const run = await manager.start(f.project, config, adapter, undefined, {sessionId: 'parent'});
    assert.equal(run.outcome, 'started');
    await dispatched(adapter);
    await assert.rejects(manager.resume(f.project, config, adapter, run.runId, 'parent'), /already running/);
    const stopped = await manager.stop(f.project, config, adapter, run.runId);
    assert(['interrupted', 'stopping'].includes(stopped.outcome));
    await manager.wait(f.project);
    assert.equal((await manager.status(f.project, config, run.runId) as any).outcome, 'interrupted');
    assert.equal(adapter.interrupts, 1);
    await manager.close();
  });
  await t.test('unload drains an awaiting-input worker and a new generation can resume', async () => {
    const first = new RunManager(options);
    const waiting = new FakeAdapter(() => ({status: 'awaiting_input', requests: [{id: 'permission'}]}));
    const run = await first.start(f.project, config, waiting);
    await first.wait(f.project);
    assert.equal((await first.status(f.project, config, run.runId) as any).outcome, 'awaiting_input');
    await first.close();
    assert.equal(waiting.interrupts, 1);
    const second = new RunManager(options);
    assert.notEqual(first.runtimeId, second.runtimeId);
    const worker = new FakeAdapter();
    await second.resume(f.project, config, worker, run.runId, 'new-parent');
    await second.wait(f.project);
    assert.equal((await second.status(f.project, config, run.runId) as any).outcome, 'clean');
    assert.notEqual(worker.seen[0]!.sessionId, waiting.seen[0]!.sessionId);
    await second.close();
  });
  await t.test('close during preflight drains preparation and prevents worker dispatch', async () => {
    const manager = new RunManager(options);
    const worker = new FakeAdapter();
    const starting = manager.start(f.project, config, worker);
    const closing = manager.close();
    const run = await starting;
    await closing;
    assert.equal(worker.submissions, 0);
    assert.equal((await manager.status(f.project, config, run.runId) as any).outcome, 'interrupted');
    await assert.rejects(manager.start(f.project, config, worker), /unloading/);
  });
  await t.test('unconfirmed shutdown keeps the checkout reserved', async () => {
    const manager = new RunManager(options);
    const waiting = new FakeAdapter(() => ({status: 'awaiting_input', requests: [{id: 'permission'}]}));
    waiting.interruptResult = false;
    const run = await manager.start(f.project, config, waiting);
    await manager.wait(f.project);
    await manager.close();
    const second = new RunManager(options);
    await assert.rejects(second.start(f.project, config, new FakeAdapter()), /Checkout reserved/);
    waiting.interruptResult = true;
    assert.equal((await second.stop(f.project, config, waiting, run.runId)).outcome, 'interrupted');
    await second.close();
  });
  await t.test('cancelling a configured check stays responsive and prevents worker dispatch', async () => {
    const marker = join(f.base, 'check-started');
    const configWithCheck = configSchema.parse({stateDir: f.stateDir, checks: [{id: 'slow', command: [process.execPath,
      '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); setInterval(() => {}, 100);`]}]});
    const manager = new RunManager(options), worker = new FakeAdapter();
    const run = await manager.start(f.project, configWithCheck, worker);
    let started = false;
    for (let i = 0; i < 4000; i++) {
      try {await stat(marker); started = true; break;} catch {await delay(5);}
    }
    assert(started, 'check did not start');
    const stopping = await manager.stop(f.project, configWithCheck, worker, run.runId);
    assert(['interrupted', 'stopping'].includes(stopping.outcome));
    await manager.wait(f.project);
    assert.equal(worker.submissions, 0);
    assert.equal((await manager.status(f.project, configWithCheck, run.runId) as any).outcome, 'interrupted');
    await manager.close();
  });
  await t.test('notification failures preserve the authoritative result and reports', async () => {
    const manager = new RunManager({...options, notify: async () => {throw new Error('recipient is closed');}});
    const run = await manager.start(f.project, config, new FakeAdapter());
    await manager.wait(f.project);
    assert.equal((await manager.status(f.project, config, run.runId) as any).outcome, 'clean');
    assert.match(await readFile(join(run.runDir, 'events.jsonl'), 'utf8'), /notice_failed/);
    await manager.close();
  });
});
