import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plugin } from '@opencode/plugin';
import { setupPlugin, protectContext } from '../src/plugin.js';
import { commandActions, parseCommand, registerCommands } from '../src/commands.js';
import { configSchema } from '../src/config.js';
import { MANAGEMENT_TOOL } from '../src/workers.js';
import { LoopService } from '../src/service.js';
import { RunManager } from '../src/manager.js';
import { registerTool } from '../src/tools.js';
import { fakeClient, until, type FakeOptions } from './fake-client.js';

const invoking = {providerID: 'fake', id: 'test', variant: 'high'};
const switched = {providerID: 'other', id: 'later'};

type Definition = {name: string; execute(input: any, context?: any): Promise<any>};
function fakeHost(options: unknown = {}) {
  const commands: Definition[] = [], tools: Definition[] = [], skills: any[] = [], notices: any[] = [];
  let disposals = 0, assertions = 0;
  let history: any[] = [];
  const register = async (callback: (editor: any) => void, entries: any[]) => {
    callback({add: (entry: any) => entries.push(entry)});
    let disposed = false;
    return {dispose: async () => { if (!disposed) {disposed = true; disposals++;} }};
  };
  const ctx = {
    app: {version: '2.2.5'}, location: {directory: '/unrelated/plugin-instance'}, options,
    session: {
      get: async ({sessionID}: {sessionID: string}) => ({id: sessionID, location: {directory: process.cwd()},
        model: switched, metadata: sessionID === 'worker' ? {openspecVerifyLoop: 'run_fake'} : {}}),
      context: async () => history,
      synthetic: async (input: any) => {notices.push(input);},
      hook: async () => ({dispose: async () => {disposals++;}}),
    },
    command: {transform: (callback: any) => register(callback, commands)},
    tool: {transform: (callback: any) => register(callback, tools)},
    skill: {transform: (callback: any) => register(callback, skills)},
    permission: {assert: async () => {assertions++;}},
  } as unknown as Plugin.Context;
  return {ctx, commands, tools, skills, notices, disposals: () => disposals, assertions: () => assertions,
    history: (value: any[]) => {history = value;}};
}

/** A tool registered on a service whose host connection is a fake client. */
async function loopTool(options: FakeOptions = {}, model: {providerID: string; id: string; variant?: string} = invoking) {
  const host = fakeHost();
  host.history([{type: 'assistant', id: 'invoking', model}, {type: 'model-switched', id: 'switch', model: switched}]);
  const fake = fakeClient({replies: ['## Verification Report: add-export\nVERDICT: CLEAN'], ...options});
  const notices: Record<string, unknown>[] = [];
  const manager = new RunManager(async (_sessionId, result) => {notices.push(result);});
  const service = new LoopService(host.ctx, manager, async () => ({adapter: fake.adapter}), 1);
  await registerTool(host.ctx, service);
  const run = async (input: object) => JSON.parse((await host.tools[0]!.execute({action: 'run', ...input},
    {sessionID: 'parent', messageID: 'invoking', agent: 'build', id: 'call'})).content);
  return {run, notices, manager, ...fake};
}

test('command grammar validates change names and never accepts shell fragments', () => {
  assert.deepEqual(parseCommand('opsx-verify-loop', ''), {action: 'run'});
  assert.deepEqual(parseCommand('opsx-verify-loop', 'add-export'), {action: 'run', change: 'add-export'});
  assert.deepEqual(parseCommand('opsx-verify-loop-stop', ''), {action: 'stop'});
  for (const value of ['add-export;rm', '$(cmd)', '--help', 'one two', '../change']) assert.throws(() => parseCommand('opsx-verify-loop', value));
  assert.throws(() => parseCommand('opsx-verify-loop-stop', 'add-export'));
});

test('plugin options accept only server and maxRounds', async () => {
  assert.deepEqual(configSchema.parse({server: 'http://127.0.0.1:4096', maxRounds: 3}), {server: 'http://127.0.0.1:4096', maxRounds: 3});
  for (const removed of ['verifierModel', 'fixerModel', 'skill', 'stateDir', 'maxMinutes', 'checks']) {
    assert.throws(() => configSchema.parse({[removed]: 'x'}));
  }
  for (const options of [{bogus: 1}, {server: 'not a url'}, {maxRounds: 0}, {maxRounds: 1.5}]) {
    const host = fakeHost(options);
    await assert.rejects(setupPlugin(host.ctx), Error, JSON.stringify(options));
    assert.equal(host.commands.length + host.tools.length + host.skills.length, 0, 'nothing is registered');
  }
});

test('the plugin refuses to load on any OpenCode version other than 2.2.5', async () => {
  const host = fakeHost();
  const ctx = {...host.ctx, app: {version: '2.2.4'}} as unknown as Plugin.Context;
  await assert.rejects(setupPlugin(ctx), /requires OpenCode 2\.2\.5/);
  assert.equal(host.commands.length + host.tools.length + host.skills.length, 0, 'nothing is registered');
});

test('registrations load the OpenCode skill text and the commands and tool share the service', async () => {
  const host = fakeHost();
  const cleanup = await setupPlugin(host.ctx);
  assert.deepEqual(host.commands.map(command => command.name), Object.keys(commandActions));
  assert.deepEqual(Object.keys(commandActions), ['opsx-verify-loop', 'opsx-verify-loop-stop', 'opsx-verify-loop-report']);
  assert.equal(host.tools[0]?.name, MANAGEMENT_TOOL);
  assert.equal((host.tools[0] as any).input.type, 'object');
  assert.deepEqual((host.tools[0] as any).input.properties.action.enum, ['run', 'stop', 'report']);
  assert.match(host.skills[0].content, /openspec_verify_loop/);
  assert.match(host.skills[0].path, /opencode\/SKILL\.md$/);
  await host.commands.find(command => command.name === 'opsx-verify-loop-stop')!.execute({sessionID: 'parent', prompt: {text: ''}});
  assert.match(host.notices[0].text, /"outcome":"not_running"/);
  assert.equal(host.notices[0].resume, true);
  await assert.rejects(host.tools[0]!.execute({action: 'run'}, {sessionID: 'worker'}), /workers cannot/);
  assert.equal(host.assertions(), 0, 'worker rejection precedes approval and dispatch');
  await cleanup();
  await cleanup();
  assert.equal(host.disposals(), 4);
});

test('the tool carries the generating message identity into the service', async () => {
  const host = fakeHost();
  const calls: unknown[] = [];
  const service = {execute: async (...args: unknown[]) => {calls.push(args); return {outcome: 'started'};}} as unknown as LoopService;
  const registration = await registerTool(host.ctx, service);
  await host.tools[0]!.execute({action: 'run'}, {sessionID: 'parent', messageID: 'invoking', agent: 'build', id: 'call'});
  assert.deepEqual(calls, [['parent', {action: 'run'}, 'invoking']]);
  await registration.dispose();
});

test('tool input with an unknown field, a field its action does not accept or a bad round limit is refused', async () => {
  const host = fakeHost();
  let calls = 0;
  await registerTool(host.ctx, {execute: async () => {calls++; return {};}} as unknown as LoopService);
  for (const input of [{action: 'run', bogus: 1}, {action: 'stop', change: 'add-export'}, {action: 'report', store: 'x'}, {action: 'run', maxRounds: 0}]) {
    await assert.rejects(host.tools[0]!.execute(input, {sessionID: 'parent', messageID: 'm', agent: 'build', id: 'call'}), Error, JSON.stringify(input));
  }
  assert.equal(calls, 0);
  assert.equal(host.assertions(), 0, 'invalid input is refused before approval');
});

test('workers use the invoking turn\'s model after a session model switch', async () => {
  const {run, notices, stats, manager} = await loopTool();
  const started = await run({change: 'add-export'});
  assert.equal(started.outcome, 'started');
  assert.deepEqual(started.model, invoking);
  await until(() => notices.length === 1);
  assert.equal(notices[0]!.status, 'clean');
  assert.deepEqual(stats.created.map(session => session.model), [invoking]);
  assert.match(stats.created[0].metadata.openspecVerifyLoop, /^run_/);
  await manager.close();
});

test('an unavailable model is refused with no substitute', async () => {
  const {run, stats} = await loopTool({models: [{id: 'test', providerID: 'fake', enabled: true, variants: []}]});
  const result = await run({});
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /Unavailable model fake\/test#high/);
  assert.equal(stats.created.length, 0);
});

test('a model with no variant or the default variant runs although the catalog lists no variants', async () => {
  for (const model of [{providerID: 'fake', id: 'test'}, {providerID: 'fake', id: 'test', variant: 'default'}]) {
    const {run, notices, manager} = await loopTool({models: [{id: 'test', providerID: 'fake', enabled: true, variants: []}]}, model);
    assert.equal((await run({})).outcome, 'started', JSON.stringify(model));
    await until(() => notices.length === 1);
    await manager.close();
  }
});

test('a missing verify skill, or several, is refused', async () => {
  const skill = {id: 'openspec-verify-change', name: 'openspec-verify-change', path: '/a/SKILL.md'};
  const missing = await loopTool({skills: []});
  assert.match((await missing.run({})).reason, /skill is missing/);
  const duplicate = await loopTool({skills: [skill, {...skill, path: '/b/SKILL.md'}]});
  assert.match((await duplicate.run({})).reason, /Expected one openspec-verify-change skill, found 2: \/a\/SKILL\.md, \/b\/SKILL\.md/);
  assert.equal(missing.stats.created.length + duplicate.stats.created.length, 0);
});

test('a stop from the starting session leaves only the run\'s notice; a stop from another session is answered', async () => {
  const host = fakeHost();
  const fake = fakeClient({hold: true, models: [{id: 'later', providerID: 'other', enabled: true, variants: []}]});
  const notices: {sessionId: string; value: any}[] = [];
  const notice = async (sessionId: string, value: unknown) => {notices.push({sessionId, value});};
  const manager = new RunManager(notice);
  await registerCommands(host.ctx, new LoopService(host.ctx, manager, async () => ({adapter: fake.adapter}), 1), notice);
  const command = (name: string, sessionID: string) =>
    host.commands.find(entry => entry.name === name)!.execute({sessionID, prompt: {text: ''}});
  const stopNotices = () => notices.filter(entry => entry.value.outcome === 'stopped' || entry.value.status === 'stopped');

  await command('opsx-verify-loop', 'parent');
  await until(() => fake.stats.prompts === 1);
  await command('opsx-verify-loop-stop', 'parent');
  assert.deepEqual(stopNotices().map(entry => [entry.sessionId, entry.value.status ?? entry.value.outcome]), [['parent', 'stopped']]);
  assert.equal(stopNotices()[0]!.value.reason, 'Stopped by user');

  notices.length = 0;
  await command('opsx-verify-loop', 'parent');
  await until(() => fake.stats.prompts === 2);
  await command('opsx-verify-loop-stop', 'other');
  assert.deepEqual(stopNotices().map(entry => [entry.sessionId, entry.value.status ?? entry.value.outcome]).sort(),
    [['other', 'stopped'], ['parent', 'stopped']]);
  assert.equal(fake.stats.interrupts, 2);
});

test('worker sessions cannot enter the service; reporting turns have no tools while ordinary turns keep them', async () => {
  const host = fakeHost();
  const service = new LoopService(host.ctx, new RunManager(async () => {}));
  await assert.rejects(service.execute('worker', {action: 'run'}), /workers cannot/);
  const event = () => ({sessionID: 'parent', tools: {[MANAGEMENT_TOOL]: {}, read: {}}, system: []}) as any;
  let context = event(); await protectContext(host.ctx, context);
  assert('read' in context.tools); assert(MANAGEMENT_TOOL in context.tools);
  host.history([{type: 'synthetic', metadata: {openspecLoopNotice: true}}]);
  context = event(); await protectContext(host.ctx, context);
  assert.deepEqual(context.tools, {}); assert.equal(context.system.length, 1);
  context = event(); context.sessionID = 'worker'; await protectContext(host.ctx, context);
  assert('read' in context.tools); assert(!(MANAGEMENT_TOOL in context.tools));
});

for (const entry of ['command', 'tool'] as const) {
  test(`${entry} stops answer failed cleanup and every retry without another terminal notice`, async () => {
    const host = fakeHost();
    const fake = fakeClient({hold: true, models: [{id: 'later', providerID: 'other', enabled: true, variants: []}]});
    const notices: {sessionId: string; value: any}[] = [];
    const notice = async (sessionId: string, value: unknown) => {notices.push({sessionId, value});};
    const manager = new RunManager(notice);
    const service = new LoopService(host.ctx, manager, async () => ({adapter: fake.adapter}), 1);
    await registerCommands(host.ctx, service, notice);
    await registerTool(host.ctx, service);
    const command = (name: string, sessionID: string) =>
      host.commands.find(item => item.name === name)!.execute({sessionID, prompt: {text: ''}});
    const stop = async (sessionID: string) => entry === 'command'
      ? command('opsx-verify-loop-stop', sessionID)
      : JSON.parse((await host.tools[0]!.execute({action: 'stop'},
        {sessionID, messageID: 'stop-turn', agent: 'build', id: 'stop-call'})).content);
    const interrupt = fake.adapter.interrupt.bind(fake.adapter);
    await command('opsx-verify-loop', 'parent');
    await until(() => fake.stats.prompts === 1);
    notices.length = 0;
    fake.adapter.interrupt = async () => false;
    const first = await stop('parent');
    if (entry === 'tool') assert.equal(first.outcome, 'failed');
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.value.status, 'failed');
    await stop('parent');
    if (entry === 'command') assert.equal(notices.at(-1)!.value.outcome, 'failed');
    fake.adapter.interrupt = interrupt;
    const last = await stop('parent');
    if (entry === 'command') assert.equal(notices.at(-1)!.value.outcome, 'stopped');
    else assert.equal(last.outcome, 'stopped');
    assert.equal(notices.filter(item => 'status' in item.value).length, 1);
    assert.equal(fake.stats.prompts, 1);

    await command('opsx-verify-loop', 'parent');
    await until(() => fake.stats.prompts === 2);
    notices.length = 0;
    fake.adapter.interrupt = async () => {throw new Error('host disconnected');};
    const other = await stop('other');
    assert.equal(notices[0]!.sessionId, 'parent');
    assert.equal(notices[0]!.value.status, 'failed');
    if (entry === 'command') {
      assert.equal(notices[1]!.sessionId, 'other');
      assert.equal(notices[1]!.value.outcome, 'failed');
    } else assert.equal(other.outcome, 'failed');
    fake.adapter.interrupt = interrupt;
    await stop('other');
    assert.equal(notices.filter(item => 'status' in item.value).length, 1);
    await manager.close();
  });
}

test('failed plugin unload keeps cleanup reachable and replies deliverable until a successful retry', async () => {
  const host = fakeHost();
  const fake = fakeClient({hold: true, models: [{id: 'later', providerID: 'other', enabled: true, variants: []}]});
  const cleanup = await setupPlugin(host.ctx, async () => ({adapter: fake.adapter}));
  const command = (name: string) => host.commands.find(item => item.name === name)!
    .execute({sessionID: 'parent', prompt: {text: ''}});
  await command('opsx-verify-loop');
  await until(() => fake.stats.prompts === 1);
  const interrupt = fake.adapter.interrupt.bind(fake.adapter);
  fake.adapter.interrupt = async () => false;
  await assert.rejects(cleanup(), new RegExp(fake.stats.created[0].id));
  assert.equal(host.disposals(), 0, 'loop controls survive unconfirmed cleanup');
  assert.equal(host.notices.filter(item => /"status":"failed"/.test(item.text)).length, 1,
    'a rejected unload must deliver the retained run failure once reporting is restored');
  await command('opsx-verify-loop-stop');
  assert.match(host.notices.at(-1).text, /"outcome":"failed"/);
  assert.match(host.notices.at(-1).text, /Checkout remains reserved/);
  await command('opsx-verify-loop');
  assert.match(host.notices.at(-1).text, /plugin is unloading/);
  fake.adapter.interrupt = interrupt;
  await command('opsx-verify-loop-stop');
  assert.match(host.notices.at(-1).text, /"outcome":"stopped"/);
  await cleanup();
  await cleanup();
  assert.equal(host.disposals(), 4);
  assert.equal(fake.stats.prompts, 1);
  assert.equal(host.notices.filter(item => /"status":"failed"/.test(item.text)).length, 1);
});

test('two plugin setups share checkout ownership and route stops to the owning instance', async t => {
  const first = fakeHost(), second = fakeHost();
  const options = {hold: true, models: [{id: 'later', providerID: 'other', enabled: true, variants: []}]};
  const a = fakeClient(options), b = fakeClient(options);
  const closeA = await setupPlugin(first.ctx, async () => ({adapter: a.adapter}));
  const closeB = await setupPlugin(second.ctx, async () => ({adapter: b.adapter}));
  t.after(async () => {await closeA(); await closeB();});
  const tool = async (host: ReturnType<typeof fakeHost>, action: string) => JSON.parse((await host.tools[0]!.execute({action},
    {sessionID: 'parent', agent: 'build', messageID: undefined, id: 'call'})).content);
  assert.equal((await tool(first, 'run')).outcome, 'started');
  await until(() => a.stats.prompts === 1);
  const duplicate = await tool(second, 'run');
  assert.equal(duplicate.outcome, 'blocked');
  assert.match(duplicate.reason, /already running/);
  assert.equal(b.stats.prompts, 0);
  const interrupt = a.adapter.interrupt.bind(a.adapter);
  a.adapter.interrupt = async () => false;
  assert.equal((await tool(second, 'stop')).outcome, 'failed');
  assert.match((await tool(second, 'run')).reason, /reserved for worker/);
  assert.equal(b.stats.prompts, 0, 'failed cleanup retains shared checkout ownership');
  a.adapter.interrupt = interrupt;
  assert.equal((await tool(second, 'stop')).outcome, 'stopped');
  assert.equal(a.stats.interrupts, 1);
  assert.equal((await tool(first, 'run')).outcome, 'started');
  await until(() => a.stats.prompts === 2);
  await closeB();
  assert.equal(a.stats.interrupts, 1, 'unloading a nonowner leaves the worker running');
  await closeA();
  assert.equal(a.stats.interrupts, 2, 'owner unload waits for worker interruption');
});

test('plugin report tool retrieves failed notices and command retries them through another instance', async t => {
  const first = fakeHost(), second = fakeHost();
  const fake = fakeClient({models: [{id: 'later', providerID: 'other', enabled: true, variants: []}]});
  const synthetic = first.ctx.session.synthetic;
  let deliveryAttempts = 0;
  first.ctx.session.synthetic = async (...args) => {
    if (args[0].text.includes('"status":"clean"')) {deliveryAttempts++; throw new Error('notice unavailable');}
    return synthetic(...args);
  };
  const closeA = await setupPlugin(first.ctx, async () => ({adapter: fake.adapter}));
  const closeB = await setupPlugin(second.ctx, async () => {throw new Error('report must not connect');});
  t.after(async () => {await closeA(); await closeB();});
  const tool = async (host: ReturnType<typeof fakeHost>, action: string) => JSON.parse((await host.tools[0]!.execute({action},
    {sessionID: 'parent', agent: 'build', id: 'call'})).content);
  const started = await tool(first, 'run');
  await until(() => deliveryAttempts === 1);
  const report = await tool(first, 'report');
  const entry = report.results.find((entry: any) => entry.result.runId === started.runId);
  assert.equal(entry.result.status, 'clean');
  assert.equal(entry.delivered, false);
  await closeA();
  await second.commands.find(command => command.name === 'opsx-verify-loop-report')!.execute({sessionID: 'parent', prompt: {text: ''}});
  assert(second.notices.some(notice => notice.text.includes(`"runId":"${started.runId}","status":"clean"`)));
  const summary = JSON.parse(second.notices.at(-1).text.split('\n')[1]);
  assert.equal(summary.results.find((entry: any) => entry.result.runId === started.runId).delivered, true);
  assert.equal((await tool(second, 'report')).results.length, 0);
  assert.equal(fake.stats.prompts, 1, 'notice retries never resubmit a worker prompt');
});
