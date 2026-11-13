import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { PiService, type PiNotice } from '../src/pi-service.js';
import { PiRuntime, readRecords } from '../src/pi-runtime.js';
import { renderRun } from '../src/pi.js';
import { hash } from '../src/pi-context.js';
import { realpath } from 'node:fs/promises';
import { answer, fakeRegistry, model } from './pi-fakes.js';
import { PI_VERSION, requirePi } from '../src/util.js';

const CLEAN = '## Verification Report: add-export\nAll checks passed.\nVERDICT: CLEAN';
const pending = async (_context: unknown, opts?: {signal?: AbortSignal}) => new Promise<ReturnType<typeof answer>>(resolve => {
  opts?.signal?.addEventListener('abort', () => resolve(answer('interrupted', 'aborted')), {once: true});
});
async function setup(t: {after: (fn: () => Promise<void>) => void}, replies: Parameters<typeof fakeRegistry>[0]) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-loop-service-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const checkout = join(directory, 'repo'); await mkdir(checkout); execFileSync('git', ['init', '-q', checkout]);
  const stateHome = join(directory, 'state');
  const procedure = join(checkout, 'SKILL.md'); await writeFile(procedure, 'verify');
  const fake = fakeRegistry(replies);
  const ctx = {cwd: checkout, model, thinkingLevel: 'high', modelRegistry: fake.registry,
    sessionManager: {getSessionId: () => 'origin'}} as unknown as ExtensionContext;
  const pi = {getCommands: () => [{name: 'skill:openspec-verify-change', source: 'skill', sourceInfo: {path: procedure}}]} as unknown as Pick<ExtensionAPI, 'getCommands'>;
  const notices: PiNotice[] = [];
  const service = new PiService(pi, notice => notices.push(notice), stateHome); t.after(() => service.shutdown());
  return {checkout, stateHome, fake, pi, ctx, service, notices};
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw new Error('Timed out waiting for Pi service');
}

test('Pi service starts in background, reports without work, refuses another owner and resumes original settings', async t => {
  const f = await setup(t, [pending]);
  const run = await f.service.start('add-export --max-rounds 2', f.ctx);
  assert.equal(run.state, 'running');
  await until(async () => f.fake.requests.length === 1);
  const viewer = new PiService(f.pi, () => {}, f.stateHome); t.after(() => viewer.shutdown());
  const report = await viewer.report(run.id, f.ctx);
  assert.equal(report.id, run.id); assert.equal(f.fake.requests.length, 1);
  await assert.rejects(viewer.start('add-export', f.ctx), /owned by Pi process/);
  await assert.rejects(f.service.resume(run.id, f.ctx), /already running/);
  await f.service.shutdown(); await f.service.shutdown();
  const interrupted = await viewer.report(run.id, f.ctx);
  assert.equal(interrupted.state, 'interrupted');
  assert.equal(interrupted.activity, undefined, 'Activity is shown only while the owner runs the call');
  const next = fakeRegistry([CLEAN]);
  const resumed = await viewer.resume(run.id, {...f.ctx, model: {...model, id: 'another'}, thinkingLevel: 'low', modelRegistry: next.registry} as unknown as ExtensionContext);
  assert.equal(resumed.id, run.id);
  await until(async () => (await viewer.report(run.id, f.ctx)).state === 'terminal');
  const finished = await viewer.report(run.id, f.ctx);
  assert.equal(finished.result?.status, 'clean');
  assert.equal(next.requests[0]!.options?.reasoning, 'high');
  assert.equal(finished.calls.length, 1);
  await assert.rejects(viewer.resume(run.id, f.ctx), /terminal/);
  await assert.rejects(viewer.stop(run.id, f.ctx), /terminal/);
  assert.equal((await viewer.report(run.id, f.ctx)).result?.status, 'clean');
});

test('Pi report shows pending worker activity from the store commit time and drops it after a reply or stop', async t => {
  let stream!: () => void; let finish!: () => void;
  const streaming = new Promise<void>(resolve => {stream = resolve;}); const finishing = new Promise<void>(resolve => {finish = resolve;});
  const f = await setup(t, [async (_context, _options, events) => {
    await streaming;
    const partial = answer(''); partial.content = [{type: 'thinking', thinking: 'Checking'}];
    events!.push({type: 'thinking_start', contentIndex: 0, partial});
    events!.push({type: 'thinking_delta', contentIndex: 0, delta: 'Checking', partial});
    partial.content.push({type: 'text', text: '## Verification'});
    events!.push({type: 'text_start', contentIndex: 1, partial});
    events!.push({type: 'text_delta', contentIndex: 1, delta: '## Verification', partial});
    await finishing;
    return answer(CLEAN);
  }, pending]);
  const directory = join(f.stateHome, 'openspec-verify-loop', hash(await realpath(f.checkout)));
  const viewer = new PiService(f.pi, () => {}, f.stateHome); t.after(() => viewer.shutdown());
  const line = async (id: string) => { const report = await viewer.report(id, f.ctx); return {report, text: renderRun(report, true, report.activity)}; };
  const run = await f.service.start('add-export', f.ctx);
  const settle = () => new Promise(resolve => setTimeout(resolve, 1500)); // past Durable's 1 s deferred progress commit
  await until(async () => f.fake.requests.length === 1); await settle();
  const waiting = await line(run.id);
  const began = waiting.report.activity!;
  assert.match(waiting.text, new RegExp(`Last worker activity: ${new Date(began).toISOString().replace(/[.]/g, '\\.')} \\(\\d+ s before this report\\)`));
  const revision = (await readRecords(directory)).revision;
  await settle();
  assert.equal((await viewer.report(run.id, f.ctx)).activity, began, 'A silent worker keeps the time waiting began');
  stream();
  await until(async () => ((await viewer.report(run.id, f.ctx)).activity ?? 0) > began);
  assert.equal((await readRecords(directory)).revision, revision, 'Streamed output must not commit run records');
  finish();
  await until(async () => (await viewer.report(run.id, f.ctx)).state === 'terminal');
  const done = await line(run.id);
  assert.equal(done.report.result?.status, 'clean'); assert.equal(done.report.activity, undefined);
  assert.doesNotMatch(done.text, /Last worker activity/);
  const second = await f.service.start('add-export', f.ctx);
  await until(async () => f.fake.requests.length === 2);
  assert.match((await line(second.id)).text, /Last worker activity/);
  await f.service.stop(second.id, f.ctx);
  const stopped = await line(second.id);
  assert.equal(stopped.report.result?.status, 'stopped'); assert.doesNotMatch(stopped.text, /Last worker activity/);
});

test('Pi service stop cancels a worker and keeps reporting inert after completion', async t => {
  const f = await setup(t, [pending]);
  const run = await f.service.start('add-export', f.ctx);
  await until(async () => f.fake.requests.length === 1);
  const stopped = await f.service.stop(run.id, f.ctx);
  assert.equal(stopped.result?.status, 'stopped');
  const requests = f.fake.requests.length;
  assert.equal((await f.service.report('', f.ctx)).result?.status, 'stopped');
  assert.equal((await f.service.report(run.id, f.ctx)).result?.status, 'stopped');
  assert.equal(f.fake.requests.length, requests);
});

test('Pi cleanup failure retains ownership and an explicit retry cleans without model work', async t => {
  const f = await setup(t, [CLEAN]);
  let failure = true;
  const service = new PiService(f.pi, notice => f.notices.push(notice), f.stateHome, async options => {
    const runtime = await PiRuntime.open(options);
    const close = runtime.close.bind(runtime);
    runtime.close = async suspend => { if (failure) throw new Error('Injected cleanup uncertainty'); await close(suspend); };
    return runtime;
  });
  t.after(() => service.shutdown());
  const run = await service.start('add-export', f.ctx);
  await until(async () => !!(await service.report(run.id, f.ctx)).cleanup);
  assert.equal((await service.report(run.id, f.ctx)).result?.status, 'failed');
  const other = new PiService(f.pi, () => {}, f.stateHome); t.after(() => other.shutdown());
  await assert.rejects(other.start('add-export', f.ctx), /owned by Pi process/);
  const requests = f.fake.requests.length;
  failure = false;
  const stopped = await service.stop(run.id, f.ctx);
  assert.equal(stopped.result?.status, 'stopped');
  assert.equal(f.fake.requests.length, requests);
  assert.equal((await other.report(run.id, f.ctx)).cleanup, null);
});

test('Pi stop losing the completion race preserves clean and releases checkout ownership', async t => {
  let complete: (message: ReturnType<typeof answer>) => void = () => {};
  let releaseDrive!: () => void;
  let driveSettled = false;
  let driverWaiting = false;
  const driveGate = new Promise<void>(resolve => {releaseDrive = resolve;});
  const f = await setup(t, [async () => new Promise(resolve => {complete = resolve;})]);
  const service = new PiService(f.pi, () => {}, f.stateHome, async options => {
    const runtime = await PiRuntime.open(options);
    const wait = runtime.wait.bind(runtime);
    runtime.wait = async id => {
      await wait(id);
      driverWaiting = true;
      await driveGate;
      driveSettled = true;
      throw new Error('Late driver completion failure');
    };
    const close = runtime.close.bind(runtime);
    runtime.close = async suspend => {
      assert.equal(driveSettled, true, 'Stop must settle the driver before closing its store');
      await close(suspend);
    };
    const stop = runtime.stop.bind(runtime);
    runtime.stop = async (id, retry) => {
      complete(answer(CLEAN));
      await until(async () => (await runtime.get(id)).state === 'terminal');
      return stop(id, retry);
    };
    return runtime;
  });
  t.after(() => service.shutdown());
  const run = await service.start('add-export', f.ctx);
  await until(async () => f.fake.requests.length === 1);
  const stopping = assert.rejects(service.stop(run.id, f.ctx), /already terminal/);
  await until(async () => driverWaiting);
  releaseDrive();
  await stopping;
  assert.equal(driveSettled, true, 'Stop must await the background driver before dropping its stop fence');
  const other = new PiService(f.pi, () => {}, f.stateHome); t.after(() => other.shutdown());
  await assert.rejects(other.stop(run.id, f.ctx), /already terminal/);
  const report = await other.report(run.id, f.ctx);
  assert.equal(report.result?.status, 'clean'); assert.equal(report.cleanup, null);
});

test('Pi resume, stop and start after a run finishes wait for its owner to release the checkout', async t => {
  let release = () => {}; let gate = Promise.resolve(); let closing = false;
  const hold = () => { closing = false; gate = new Promise(resolve => {release = resolve;}); };
  const f = await setup(t, [CLEAN, CLEAN, pending]);
  const service = new PiService(f.pi, () => {}, f.stateHome, async options => {
    const runtime = await PiRuntime.open(options);
    const close = runtime.close.bind(runtime);
    runtime.close = async suspend => { closing = true; await gate; await close(suspend); };
    return runtime;
  });
  t.after(async () => { release(); await service.shutdown(); });
  hold();
  const run = await service.start('add-export', f.ctx);
  await until(async () => closing);
  assert.equal((await service.report(run.id, f.ctx)).state, 'terminal');
  const resuming = assert.rejects(service.resume(run.id, f.ctx), /terminal and cannot be resumed/);
  release(); await resuming;
  await assert.rejects(service.stop(run.id, f.ctx), /already terminal/);
  hold();
  const second = await service.start('add-export', f.ctx);
  await until(async () => closing);
  const starting = service.start('add-export', f.ctx);
  release();
  assert.notEqual((await starting).id, second.id);
  await service.shutdown();
});

test('Pi state cannot be placed in the working tree through a symlink alias', async t => {
  const f = await setup(t, []);
  const alias = join(f.stateHome, '..', 'state-alias');
  await symlink(f.checkout, alias);
  const service = new PiService(f.pi, () => {}, alias); t.after(() => service.shutdown());
  await assert.rejects(service.start('add-export', f.ctx), /outside the checkout/);
  assert.equal(f.fake.requests.length, 0);
});

async function files(directory: string) {
  const entries = await readdir(directory, {recursive: true, withFileTypes: true});
  return Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const path = join(entry.parentPath, entry.name);
    return {path, bytes: (await readFile(path)).toString('base64'), mtime: (await stat(path)).mtimeMs};
  }));
}

test('Pi report never writes: a torn store tail and a missing state directory stay untouched', async t => {
  const f = await setup(t, [pending]);
  const run = await f.service.start('add-export', f.ctx);
  await until(async () => f.fake.requests.length === 1); await f.service.shutdown();
  const directory = join(f.stateHome, 'openspec-verify-loop', hash(await realpath(f.checkout)));
  await appendFile(join(directory, 'store', 'main.jsonl'), '{"format":1,"type":"comm');
  const before = await files(directory);
  const viewer = new PiService(f.pi, () => {}, f.stateHome); t.after(() => viewer.shutdown());
  const report = await viewer.report('', f.ctx);
  assert.equal(report.id, run.id); assert.equal(report.state, 'interrupted');
  assert.deepEqual(await files(directory), before);
  const other = join(f.checkout, '..', 'other'); await mkdir(other); execFileSync('git', ['init', '-q', other]);
  await assert.rejects(viewer.report('', {cwd: other}), /No unfinished loop/);
  assert.deepEqual(await readdir(join(f.stateHome, 'openspec-verify-loop')), [hash(await realpath(f.checkout))]);
});

test('Pi releases ownership if opening its store fails', async t => {
  const f = await setup(t, []);
  const service = new PiService(f.pi, () => {}, f.stateHome, async () => {throw new Error('Injected open failure');});
  t.after(() => service.shutdown());
  await assert.rejects(service.start('add-export', f.ctx), /open failure/);
  assert.equal(f.fake.requests.length, 0);
  const other = new PiService(f.pi, () => {}, f.stateHome); t.after(() => other.shutdown());
  await assert.rejects(other.stop('', f.ctx), /No unfinished loop/);
});

test('Pi start and resume accept the minimum Pi version or later and refuse older or unparseable versions', () => {
  for (const v of [PI_VERSION, '1.5.3', '1.5.10', '1.6.0', '1.10.0', '2.0.0', '10.0.0', '1.6.0-beta.1']) requirePi(v);
  assert.throws(() => requirePi('1.5.1'), {message: `Pi loop requires Pi ${PI_VERSION} or later; found 1.5.1`});
  for (const v of ['1.4.9', '0.0.0', 'abc']) assert.throws(() => requirePi(v), /or later; found/);
});
