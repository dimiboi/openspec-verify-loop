import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenCodeClient } from '@opencode/client';
import { Attempt, command, checked, type Command, type Options } from './live/common.js';
import { runOpenCode, snapshot } from './live/opencode.js';

async function setup(t: {after(fn: () => unknown): void}, scenario: Options['scenario'] = 'fix-to-clean') {
  const root = await mkdtemp(join(tmpdir(), 'live-oc-unit-')); t.after(() => rm(root, {recursive: true, force: true}));
  const skill = join(root, 'installed'); await mkdir(skill);
  await writeFile(join(skill, 'SKILL.md'), '---\nname: openspec-verify-change\n---\nTest-only procedure\n');
  const input: Options = {host: 'opencode', scenario, provider: 'fake', model: 'model', variant: 'default', procedure: join(skill, 'SKILL.md'),
    output: root, timeout: 10_000, cleanupTimeout: 2000};
  return input;
}
const fakeInstall: Command = (file, args, opts) => file === 'npm' ? Promise.resolve({code: 0, stdout: 'fake install', stderr: ''}) : command(file, args, opts);

function fakeHost(settings: {stop?: boolean; lostStart?: boolean; badReport?: boolean; race?: boolean; failCleanup?: boolean; queued?: boolean; unavailable?: boolean; emptyCatalogue?: boolean; pages?: boolean; missingProcedure?: boolean} = {}) {
  const calls: string[] = []; let origin = '', directory = '', stopped = false, observations = 0, catalogues = 0;
  const model = {providerID: 'fake', id: 'model', variant: 'default'};
  const worker = (index: number) => ({id: `worker-${index}`, title: `OpenSpec ${index % 2 ? 'fixer' : 'verifier'} ${index + 1}: run-test`,
    model, metadata: {openspecVerifyLoop: 'run-test'}, location: {directory},
    outcome: settings.stop && !stopped && !settings.race ? undefined : 'succeeded',
    time: {created: 100 + index * 100, busy: 101 + index * 100, idle: settings.stop && !stopped && !settings.race ? undefined : 190 + index * 100}});
  const synthetic = (id: string, value: unknown) => ({id, type: 'synthetic', text: 'Loop notice\n' + JSON.stringify(value), metadata: {openspecLoopNotice: true}, time: {created: 400}});
  const start = () => synthetic('start', {outcome: 'started', runId: 'run-test', model});
  const terminal = () => synthetic('end', {status: stopped ? 'stopped' : 'clean', runId: 'run-test', change: 'add-greeting', rounds: 2});
  const assistant = (id: string) => ({id, type: 'assistant', agent: 'default', model, content: settings.badReport ? [{type: 'tool', name: 'shell'}] : [{type: 'text', text: 'reported'}], time: {created: 401, completed: 402}, finish: 'stop'});
  const idle = (id: string) => ({id, type: 'idle', outcome: 'succeeded', time: {created: 403}});
  const hasTerminal = () => !settings.stop || stopped || settings.race;
  const originMessages = () => [start(), assistant('report-start'),
    ...(hasTerminal() && (!settings.queued || observations > 1) ? [terminal(), assistant('report-end'), idle('idle-end')] : [])];
  const c = {
    server: {info: async () => ({version: '2.2.5', pid: 1})}, location: {get: async () => ({})},
    plugin: {list: async () => ({data: settings.emptyCatalogue && catalogues++ === 0 ? [] : [{id: 'openspec.verify-loop', source: {type: 'package', target: join(currentFixture(), '../plugin')}, state: {status: 'active'}}]})},
    command: {list: async () => ({data: [{name: 'opsx-verify-loop'}, {name: 'opsx-verify-loop-stop'}]})},
    skill: {list: async () => ({data: [{id: 'openspec-verify-loop'}, ...(settings.missingProcedure ? [] : [{id: 'openspec-verify-change', path: join(directory || currentFixture(), '.agents/skills/openspec-verify-change/SKILL.md')}])]})},
    model: {list: async () => ({data: settings.unavailable ? [] : [{...model, enabled: true, variants: []}]})},
    session: {
      create: async (input: {id: string; location: {directory: string}}) => { calls.push('create'); origin = input.id; directory = input.location.directory; return {id: origin}; },
      get: async ({sessionID}: {sessionID: string}) => {
        if (sessionID !== origin) return worker(Number(sessionID.split('-').at(-1)));
        observations++;
        return {id: origin, model, location: {directory}, time: {created: 1, busy: 2, idle: 500}, outcome: 'succeeded'};
      },
      command: async (input: {name: string}) => {
        calls.push(input.name);
        if (input.name === 'opsx-verify-loop-stop') { stopped = true; return; }
        await writeFile(join(directory, 'greet.mjs'), "export const greet = name => `Hello, ${name || 'world'}!`;\n");
        if (settings.lostStart) throw new Error('lost response');
      },
      list: async () => ({data: Array.from({length: settings.stop ? 1 : 3}, (_, i) => worker(i)), cursor: {}}),
      active: async () => (settings.failCleanup || (settings.stop && !stopped && !settings.race)) ? {'worker-0': {}} : {},
      inbox: {
        list: async ({sessionID}: {sessionID: string}) => sessionID === origin && settings.queued && observations <= 1 ? [{id: 'end', type: 'synthetic', payload: terminal()}] : [],
        cancel: async () => { calls.push('cancel'); },
      },
      interrupt: async () => { calls.push('interrupt'); },
    },
    experimental: {session: {wait: async () => { calls.push('wait'); }}},
    message: {list: async ({sessionID, cursor}: {sessionID: string; cursor?: string}) => {
      if (sessionID === origin && settings.pages && !cursor) return {data: [], cursor: {next: 'second'}};
      return {data: sessionID === origin ? originMessages() : [{id: 'input', type: 'user', text: `Read ${join(directory, '.agents/skills/openspec-verify-change/SKILL.md')}`}], cursor: {}};
    }},
  };
  let fixture = '';
  function currentFixture() { return fixture; }
  c.location.get = async () => ({});
  return {client: c as unknown as OpenCodeClient, calls, setFixture: (path: string) => { fixture = path; }};
}

test('runnable snapshot resolves external dependencies offline and preserves relative resources', async t => {
  const input = await setup(t); const attempt = await Attempt.create(input);
  const offline: Command = (file, args, opts) => command(file, args, {...opts, env: {...process.env, npm_config_offline: 'true'}});
  const target = await snapshot(attempt, offline);
  const paths = JSON.parse(await checked(process.execPath, ['--input-type=module', '-e',
    'await import("./dist/index.js"); console.log(JSON.stringify([import.meta.resolve("@opencode/client"), import.meta.resolve("@opencode/plugin")]))'], {cwd: target}));
  assert(paths.every((path: string) => new URL(path).pathname.startsWith(target)));
  assert.match(await readFile(join(target, 'skills/openspec-verify-loop/verify-loop.js'), 'utf8'), /export const meta/);
});

// Fake catalogue paths are selected by location.get before any origin session exists.
function connected(host: ReturnType<typeof fakeHost>) {
  host.client.location.get = async input => { host.setFixture(input!.location!.directory!); return {} as never; };
  return async () => host.client;
}
test('native command is dispatched once after a lost response and a queued terminal notice is collected', async t => {
  const input = await setup(t); const host = fakeHost({lostStart: true, queued: true, emptyCatalogue: true, pages: true});
  const {attempt, code} = await runOpenCode(input, {run: fakeInstall, connect: connected(host)});
  assert.equal(code, 0, JSON.stringify(attempt.result));
  assert.equal(host.calls.filter(c => c === 'opsx-verify-loop').length, 1);
  assert.equal(attempt.result.workers.length, 3);
});
test('normal active stop is distinct from a stop that loses the completion race', async t => {
  const input = await setup(t, 'stop'), host = fakeHost({stop: true});
  const stopped = await runOpenCode(input, {run: fakeInstall, connect: connected(host)});
  assert.equal(stopped.code, 0, JSON.stringify(stopped.attempt.result));
  assert(host.calls.includes('opsx-verify-loop-stop')); assert(!host.calls.includes('interrupt'));
  const raced = await runOpenCode(input, {run: fakeInstall, connect: connected(fakeHost({stop: true, race: true}))});
  assert.equal(raced.code, 1); assert.equal(raced.attempt.result.status, 'not_exercised');
});
test('reporting tools fail assertions and unavailable models fail before session creation', async t => {
  const input = await setup(t), host = fakeHost({badReport: true});
  const bad = await runOpenCode(input, {run: fakeInstall, connect: connected(host)});
  assert.equal(bad.code, 1); assert.equal(bad.attempt.result.assertions.find(c => c.name === 'Reporting turns use no tools')?.passed, false);
  const unavailable = fakeHost({unavailable: true});
  const missing = await runOpenCode(input, {run: fakeInstall, connect: connected(unavailable)});
  assert.equal(missing.code, 1); assert.equal(missing.attempt.result.stage, 'setup'); assert(!unavailable.calls.includes('create'));
  const noProcedure = fakeHost({missingProcedure: true});
  const ambiguous = await runOpenCode(input, {run: fakeInstall, connect: connected(noProcedure)});
  assert.equal(ambiguous.code, 1); assert(!noProcedure.calls.includes('create'));
});
test('absent existing service does not start one; cleanup failure retains worker identities', async t => {
  const input = await setup(t);
  const absent = await runOpenCode(input, {run: fakeInstall, connect: async () => { throw new Error('No compatible existing service'); }});
  assert.equal(absent.code, 1); assert.equal(absent.attempt.result.originId, undefined);
  const host = fakeHost({stop: true, failCleanup: true});
  const failed = await runOpenCode({...input, scenario: 'stop'}, {run: fakeInstall, connect: connected(host)});
  assert.equal(failed.code, 1); assert.equal(failed.attempt.result.cleanup.confirmed, false);
  assert(failed.attempt.result.workers.some(w => w.id === 'worker-0'));
});
