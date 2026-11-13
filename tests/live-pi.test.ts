import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { hash } from '../src/pi-context.js';
import { PiRecords, readRecords, type PiRun } from '../src/pi-runtime.js';
import { renderRun } from '../src/pi.js';
import { command, options, type Options } from './live/common.js';
import { runPi } from './live/pi.js';
import type { PiConnection } from './live/pi-rpc.js';

async function fakePi(t: {after: (fn: () => Promise<void>) => void}, scenario: Options['scenario'], settings: {
  race?: boolean; wrongModel?: boolean; duplicate?: boolean; lostStart?: boolean; failCleanup?: boolean; invalidFixture?: boolean; nativeError?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-live-fake-')); t.after(() => rm(root, {recursive: true, force: true}));
  const skill = join(root, 'installed'); await mkdir(skill);
  const procedure = join(skill, 'SKILL.md'); await writeFile(procedure, '---\nname: openspec-verify-change\n---\nVerify the change.');
  const input: Options = {host: 'pi', scenario, provider: 'fake', model: 'model', reasoning: 'medium', procedure,
    variant: 'default', timeout: 10_000, cleanupTimeout: 1000, output: root};
  let report: PiRun | undefined; let store = ''; let fixture = ''; let revision = 0; let started = 0; let resumed = false; let connections = 0;
  const calls: string[] = []; let reportText = '';
  const save = async () => {
    const harness = await Harness.open(await openNodeJsonlStorage(store, context), {registry: createRegistry(), models: createModels()}, context);
    try { await harness.commit(async tx => {const book = await tx.doc(PiRecords); book.revision = ++revision; book.runs = [JSON.parse(JSON.stringify(report))];}, context); }
    finally { await harness.close(context); }
  };
  const done = async () => {
    if (!report) return;
    report.calls[1]!.reply = 'Fixed.';
    report.calls.push({conversation: 3, submission: 13, requestId: 'worker-3', prompt: 'Verify', role: 'verifier', label: 'Verify 2', reply: 'VERDICT: CLEAN', failure: null, admission: 'admitted'} as PiRun['calls'][number]);
    report.state = 'terminal'; report.result = {status: 'clean', reason: 'clean', rounds: 2, change: 'add-greeting', report: 'VERDICT: CLEAN'};
    await writeFile(join(fixture, 'greet.mjs'), settings.invalidFixture ? 'export const greet=()=>"incorrect";' : 'export const greet=(name)=>`Hello, ${name || "world"}!`;');
    if (settings.duplicate) report.calls[0]!.submission = 99 as PiRun['calls'][number]['submission'];
    await save();
  };
  const deps: Parameters<typeof runPi>[1] = {
    run: async (file, args, opts) => file === 'pi' ? {code: 0, stdout: '1.5.2\n', stderr: ''}
      : file === 'npm' ? {code: 0, stdout: '', stderr: ''} : command(file, args, opts),
    connect: (attempt, agentDir, args) => {
      connections++; fixture = attempt.fixture;
      store = join(agentDir, 'openspec-verify-loop', hash(attempt.fixture.replace(/^\/var\//, '/private/var/')), 'store');
      let alive = true;
      const staged = args[args.indexOf('--skill') + 1]!;
      const connection: PiConnection = {
        alive: () => alive, flush: async () => {}, close: async () => {alive = false;},
        request: async (type, values) => {
          calls.push(`${type} ${values.message ?? ''}`);
          if (type === 'get_commands') return {commands: [
            ...['opsx-verify-loop', 'opsx-verify-loop-stop', 'opsx-verify-loop-report', 'opsx-verify-loop-resume'].map(name => ({name, source: 'extension', sourceInfo: {path: 'package'}})),
            {name: 'skill:openspec-verify-change', source: 'skill', sourceInfo: {path: staged}},
          ]};
          if (type === 'get_state') return {model: {provider: input.provider, id: input.model}, thinkingLevel: 'medium', sessionId: `origin-${connections}`};
          if (type === 'get_entries') return {entries: settings.nativeError ? [{id: 'error', type: 'custom_message',
            customType: 'openspec-verify-loop', details: {event: 'error', reason: 'Native command rejected'}}]
            : reportText ? [{id: 'report', type: 'custom_message', customType: 'openspec-verify-loop', content: reportText, details: {event: 'report'}}] : []};
          reportText = '';
          assert.equal(type, 'prompt');
          const message = String(values.message);
          if (message.startsWith('/opsx-verify-loop ')) {
            started++;
            report = {id: 'run_abc', version: 1, created: 1, state: 'running', result: null, cleanup: null, task: null,
              settings: {checkout: await realpath(fixture), directory: await realpath(fixture), origin: 'origin', instructions: '',
                model: {provider: input.provider, modelId: input.model}, thinkingLevel: 'medium', procedurePath: staged, procedureHash: hash(await readFile(staged, 'utf8'))},
              args: {change: 'add-greeting', store: null, maxRounds: 5}, maxAgentCalls: 9, loopHash: 'loop', calls: [
                {conversation: 1, submission: 11, requestId: 'worker-1', prompt: 'Verify', role: 'verifier', label: 'Verify 1',
                  reply: scenario === 'stop' ? null : 'VERDICT: ISSUES', failure: null, admission: 'admitted'},
                ...(scenario === 'stop' ? [] : [{conversation: 2, submission: 12, requestId: 'worker-2', prompt: 'Fix', role: 'fixer', label: 'Fix 1', reply: null, failure: null, admission: 'admitted'}]),
              ]} as PiRun;
            await save(); if (settings.race) {if (scenario === 'stop') {report.state = 'terminal'; report.result = {status: 'failed', reason: 'finished before stop'}; await save();} else await done();}
            if (settings.lostStart) throw new Error('Lost native start response');
          } else if (message.startsWith('/opsx-verify-loop-stop')) {
            assert(report); report.state = 'terminal'; report.result = {status: 'stopped', reason: 'Stopped'}; await save();
          } else if (message.startsWith('/opsx-verify-loop-resume')) resumed = true;
          else if (message.startsWith('/opsx-verify-loop-report')) {
            const {runs: [run], committed} = await readRecords(dirname(store));
            if (connections > 1 && !resumed) run!.state = 'interrupted';
            reportText = renderRun(run!, true, run!.state === 'running' ? committed : undefined);
          }
          return {disposition: 'handled'};
        },
      };
      return connection;
    },
    pause: async () => {if ((scenario === 'fix-to-clean' || resumed) && report?.state !== 'terminal') await done();},
    inspect: async (attempt, _directory, saved) => {
      attempt.result.workers = saved.calls.map((call, i) => ({id: String(call.conversation), role: call.role, start: i * 10,
        end: i * 10 + 5, active: !!settings.failCleanup, settings: {provider: input.provider, model: settings.wrongModel ? 'other' : input.model, reasoning: 'medium'}}));
    },
  };
  return {input, deps, calls, started: () => started};
}

test('Pi live options require a model and isolate host-specific flags', () => {
  assert.throws(() => options('pi', ['--scenario', 'resume']), /provider/);
  assert.throws(() => options('bb', ['--scenario', 'resume']), /scenario/);
  const args = ['--scenario', 'resume', '--provider', 'fake', '--model', 'model', '--procedure', '/procedure/SKILL.md'];
  assert.equal(options('pi', args)?.scenario, 'resume');
  assert.throws(() => options('pi', [...args, '--variant', 'high']), /variant/);
});

for (const scenario of ['fix-to-clean', 'stop', 'resume'] as const) test(`Pi live ${scenario} uses native commands and retained evidence`, async t => {
  const fake = await fakePi(t, scenario);
  const {attempt, code} = await runPi(fake.input, fake.deps);
  assert.equal(code, 0, JSON.stringify(attempt.result));
  assert.equal(fake.started(), 1); assert.equal(attempt.result.cleanup.confirmed, true);
  assert(fake.calls.some(call => call.startsWith('prompt /opsx-verify-loop ')));
  if (scenario === 'resume') assert(fake.calls.some(call => call.startsWith('prompt /opsx-verify-loop-resume')));
  const names = attempt.result.assertions.map(check => check.name);
  for (const name of ['Running report shows last worker activity', 'Report activity matches the store commit time',
    ...scenario === 'resume' ? ['Interrupted report shows no worker activity'] : []]) assert(names.includes(name), name);
});

test('Pi live resume detects duplicate admissions and never launches a replacement', async t => {
  const fake = await fakePi(t, 'resume', {duplicate: true});
  const {attempt, code} = await runPi(fake.input, fake.deps);
  assert.equal(code, 1); assert.equal(fake.started(), 1);
  assert(attempt.result.assertions.some(check => !check.passed && check.name.includes('Completed workers')));
});

test('Pi live rejects weakened fixture behavior and wrong inherited settings', async t => {
  for (const settings of [{invalidFixture: true}, {wrongModel: true}, {failCleanup: true}]) {
    const fake = await fakePi(t, 'fix-to-clean', settings);
    const {attempt, code} = await runPi(fake.input, fake.deps);
    assert.equal(code, 1, JSON.stringify(attempt.result)); assert.equal(fake.started(), 1);
  }
});

test('Pi live records a missed stop rather than claiming a cancellation pass', async t => {
  const fake = await fakePi(t, 'stop', {race: true});
  const {attempt, code} = await runPi(fake.input, fake.deps);
  assert.equal(code, 1); assert.equal(attempt.result.status, 'not_exercised'); assert.equal(fake.started(), 1);
});

test('Pi live reconciles a lost launch through observation and only sends cleanup', async t => {
  const fake = await fakePi(t, 'stop', {lostStart: true});
  const {attempt, code} = await runPi(fake.input, fake.deps);
  assert.equal(code, 1); assert.equal(fake.started(), 1); assert.equal(attempt.result.cleanup.confirmed, true);
  assert(fake.calls.some(call => call.startsWith('prompt /opsx-verify-loop-stop')));
});

test('Pi live detects native Pi custom-message errors', async t => {
  const fake = await fakePi(t, 'fix-to-clean', {nativeError: true});
  const {attempt, code} = await runPi(fake.input, fake.deps);
  assert.equal(code, 1); assert.equal(fake.started(), 1);
  assert(attempt.result.errors.some(error => error.includes('Native Pi command failed: Native command rejected')));
});
