import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readRecords } from '../src/pi-runtime.js';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { createRegistry, defineDoc, Harness } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';

// Real installed Pi Durable JSONL storage, no model: what the Pi report's read-only open relies on.
const Counter = defineDoc<{n: number}>({kind: 'test.counter', version: 1, scope: 'session', initial: () => ({n: 0}), checkpointWhen: () => true});
const repository = fileURLToPath(new URL('..', import.meta.url));
const options = (readOnly: boolean) => ({readOnly, registry: createRegistry(), models: createModels()});

async function open(store: string, readOnly = true) {
  return Harness.open(await openNodeJsonlStorage(store, context, {readOnly}), options(readOnly), context);
}
async function read(store: string): Promise<number> {
  const harness = await open(store);
  try { return (await harness.snapshot(Counter, context))?.n ?? 0; } finally { await harness.close(context); }
}
async function files(directory: string) {
  const names = (await readdir(directory)).sort();
  return Promise.all(names.map(async name => ({name, bytes: (await readFile(join(directory, name))).toString('base64'),
    mtime: (await stat(join(directory, name))).mtimeMs})));
}

test('Durable read-only JSONL open writes nothing over a torn tail and an unconfirmed sidecar record', async t => {
  const root = await mkdtemp(join(tmpdir(), 'durable-readonly-')); t.after(() => rm(root, {recursive: true, force: true}));
  const store = join(root, 'store');
  const writer = await open(store, false);
  for (let i = 0; i < 3; i++) await writer.commit(async tx => {(await tx.doc(Counter)).n++;}, context);
  await writer.close(context);
  const sidecar = (await readdir(store)).find(name => name.startsWith('doc-'))!;
  await appendFile(join(store, sidecar), `${JSON.stringify({format: 1, type: 'record', seq: 99, ordinal: 0,
    payload: {type: 'document', id: Number(sidecar.slice(4, -6)), content: {version: 1, kind: 'base', value: {n: 99}}}})}\n`);
  await appendFile(join(store, 'main.jsonl'), '{"format":1,"type":"comm');
  const before = await files(store);
  assert.equal(await read(store), 3, 'skips the torn line and the unconfirmed record');
  assert.deepEqual(await files(store), before, 'bytes and mtimes are unchanged');
  await (await open(store, false)).close(context);
  assert.notDeepEqual(await files(store), before, 'control: a writable open repairs the same files');
});

test('Durable read-only JSONL open never creates a missing directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'durable-readonly-')); t.after(() => rm(root, {recursive: true, force: true}));
  await assert.rejects(read(join(root, 'missing', 'store')), /ENOENT/);
  assert.deepEqual(await readdir(root), []);
});

test('Durable read-only handles hold their open state; fresh opens see a live writer process commit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'durable-readonly-')); t.after(() => rm(root, {recursive: true, force: true}));
  const store = join(root, 'store');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { BACKGROUND_CONTEXT as c } from '@earendil-works/chord/context';
    import { createModels } from '@earendil-works/pi-ai';
    import { createRegistry, defineDoc, Harness } from '@earendil-works/pi-durable';
    import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
    const Counter = defineDoc({kind: 'test.counter', version: 1, scope: 'session', initial: () => ({n: 0}), checkpointWhen: () => true});
    const h = await Harness.open(await openNodeJsonlStorage(${JSON.stringify(store)}, c, {fsync: true}), {registry: createRegistry(), models: createModels()}, c);
    for (let n = 1; n <= 150; n++) { await h.commit(async tx => { (await tx.doc(Counter)).n = n; }, c); console.log(n); }
    await h.close(c);`], {cwd: repository, stdio: ['ignore', 'pipe', 'inherit']});
  t.after(() => {child.kill();});
  let written = 0;
  const lines = createInterface({input: child.stdout!}); lines.on('line', line => {written = Number(line);});
  const exited = new Promise(resolve => child.once('exit', resolve));
  while (written < 1) await new Promise(resolve => setTimeout(resolve, 5));
  const held = await open(store); const heldValue = (await held.snapshot(Counter, context))!.n;
  let reads = 0; let raced = 0; let last = 0;
  while (child.exitCode === null) {
    const floor = written;
    try {
      const n = await read(store);
      assert(n >= floor && n >= last, `fresh open saw ${n} after ${floor} was committed`); last = n; reads++;
    } catch (error) {
      // Durable 1.5.1 and 1.5.2 do not retry a read-only open whose directory listing raced a writer removing a file.
      if ((error as {cause?: {code?: string}}).cause?.code !== 'not_found') throw error;
      raced++;
    }
    assert.deepEqual((await readRecords(root)).runs, [], 'the report reader retries that race');
  }
  await exited;
  assert.equal(child.exitCode, 0);
  assert.equal((await held.snapshot(Counter, context))!.n, heldValue, 'a handle keeps the state committed at its open');
  await held.close(context);
  assert.equal(await read(store), 150, 'a fresh open after the writer sees its last commit');
  assert(reads > 0);
  console.log(`held handle: ${heldValue}; fresh reads during writes: ${reads}, last ${last}; listing races: ${raced}; after writer: 150`);
});
