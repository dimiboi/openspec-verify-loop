import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context, withAbortSignal } from '@earendil-works/chord/context';
import { SupervisedEnv, reconcileCommands } from '../src/pi-process.js';
import { atomicJson, readJson } from '../src/pi-files.js';
import type { CommandReceipt } from '../src/pi-supervisor.js';

async function poll(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for supervised process');
}

test('supervised Pi commands preserve output and real exit codes and confirm cancellation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-loop-process-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const receipts = join(directory, 'commands');
  const env = new SupervisedEnv(directory, receipts); t.after(() => env.cleanup(context));
  let output = '';
  const result = await env.exec('printf visible; exit 7', {onOutput: chunk => {output += chunk;}}, context);
  assert(result.ok); assert.equal(result.value.exitCode, 7); assert.equal(output, 'visible');
  const abort = new AbortController();
  const marker = join(directory, 'active');
  const active = env.exec([process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1],"active"); setInterval(()=>{},1000)', marker], undefined, withAbortSignal(abort.signal, context));
  await poll(async () => { try { return await readFile(marker, 'utf8') === 'active'; } catch { return false; } });
  abort.abort();
  const cancelled = await active; assert(!cancelled.ok); assert.equal(cancelled.error.code, 'aborted');
  await reconcileCommands(receipts, false);
  for (const file of await readdir(receipts)) assert.equal((await readJson<CommandReceipt>(join(receipts, file)))?.state, 'done');
});

test('a Pi command supervisor stops descendants after its owner process is killed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-loop-orphan-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const receipts = join(directory, 'commands'); const marker = join(directory, 'heartbeat');
  const source = `import {SupervisedEnv} from ${JSON.stringify(new URL('../src/pi-process.ts', import.meta.url).href)};
    import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';
    const env=new SupervisedEnv(${JSON.stringify(directory)},${JSON.stringify(receipts)});
    await env.exec([process.execPath,'-e','const fs=require("node:fs");setInterval(()=>fs.appendFileSync(process.argv[1],"x"),20)',${JSON.stringify(marker)}],undefined,BACKGROUND_CONTEXT);`;
  const parent = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {stdio: 'ignore'});
  t.after(async () => { parent.kill('SIGKILL'); await reconcileCommands(receipts, true); });
  await poll(async () => { try { return (await readFile(marker)).length > 0; } catch { return false; } });
  parent.kill('SIGKILL');
  await poll(async () => { try { await reconcileCommands(receipts, false); return true; } catch { return false; } });
  const stopped = await readFile(marker, 'utf8'); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await readFile(marker, 'utf8'), stopped);
});

test('Pi recovery refuses an uncertain command intent instead of assuming no process ran', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-loop-uncertain-command-')); t.after(() => rm(directory, {recursive: true, force: true}));
  await atomicJson(join(directory, 'intent.json'), {token: 'intent', parent: process.pid, state: 'planned', process: null} satisfies CommandReceipt);
  await assert.rejects(reconcileCommands(directory, false), /admission is uncertain/);
  await assert.rejects(reconcileCommands(directory, true), /admission is uncertain/);
});
