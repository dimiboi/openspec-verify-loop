import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireOwnership, hasLiveOwner, processIdentity } from '../src/pi-ownership.js';
import { atomicJson } from '../src/pi-files.js';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

test('Pi process identities are stable across caller timezones and locales', () => {
  const source = `import {processIdentity} from ${JSON.stringify(new URL('../src/pi-ownership.ts', import.meta.url).href)};
    console.log(JSON.stringify(await processIdentity(${process.pid})));`;
  const identify = (TZ: string, LC_ALL: string) => JSON.parse(execFileSync(process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source], {encoding: 'utf8', env: {...process.env, TZ, LC_ALL}}));
  assert.deepEqual(identify('UTC', 'C'), identify('Europe/Helsinki', 'fi_FI.UTF-8'));
});

test('Pi ownership refuses a live second owner and releases only its own token', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-loop-owner-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const first = await acquireOwnership(directory);
  assert(await hasLiveOwner(directory));
  await assert.rejects(acquireOwnership(directory), /owned by Pi process/);
  await first.assert(); await first.release();
  assert.equal(await hasLiveOwner(directory), false);
  const second = await acquireOwnership(directory);
  await assert.rejects(first.release(), /another Pi owner/);
  await second.assert(); await second.release();
});

test('Pi ownership verifies process identity rather than age and refuses uncertain lock changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-loop-stale-owner-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const identity = await processIdentity(process.pid); assert(identity);
  await atomicJson(join(directory, 'owner.json'), {...identity, start: 'old process identity', token: 'old'});
  const current = await acquireOwnership(directory); await current.release();
  await mkdir(join(directory, 'ownership.guard'));
  await assert.rejects(acquireOwnership(directory), /in progress or uncertain/);
});

test('independent Pi processes cannot take over a live owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-loop-second-process-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const source = `import {acquireOwnership} from ${JSON.stringify(new URL('../src/pi-ownership.ts', import.meta.url).href)};
    await acquireOwnership(${JSON.stringify(directory)}); process.stdout.write('ready'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {stdio: ['ignore', 'pipe', 'inherit']});
  t.after(() => {child.kill('SIGKILL');});
  await once(child.stdout!, 'data');
  await assert.rejects(acquireOwnership(directory), /owned by Pi process/);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const recovered = await acquireOwnership(directory); await recovered.release();
});
