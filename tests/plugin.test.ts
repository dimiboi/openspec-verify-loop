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
async function loopTool(options: FakeOptions = {}) {
  const host = fakeHost();
  host.history([{type: 'assistant', id: 'invoking', model: invoking}, {type: 'model-switched', id: 'switch', model: switched}]);
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

test('plugin options accept only server and maxRounds', () => {
  assert.deepEqual(configSchema.parse({server: 'http://127.0.0.1:4096', maxRounds: 3}), {server: 'http://127.0.0.1:4096', maxRounds: 3});
  for (const removed of ['verifierModel', 'fixerModel', 'skill', 'stateDir', 'maxMinutes', 'checks']) {
    assert.throws(() => configSchema.parse({[removed]: 'x'}));
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
  assert.deepEqual(Object.keys(commandActions), ['opsx-verify-loop', 'opsx-verify-loop-stop']);
  assert.equal(host.tools[0]?.name, MANAGEMENT_TOOL);
  assert.equal((host.tools[0] as any).input.type, 'object');
  assert.deepEqual((host.tools[0] as any).input.properties.action.enum, ['run', 'stop']);
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

test('a missing verify skill, or several, is refused', async () => {
  const skill = {id: 'openspec-verify-change', name: 'openspec-verify-change', path: '/a/SKILL.md'};
  const missing = await loopTool({skills: []});
  assert.match((await missing.run({})).reason, /skill is missing/);
  const duplicate = await loopTool({skills: [skill, {...skill, path: '/b/SKILL.md'}]});
  assert.match((await duplicate.run({})).reason, /Expected one openspec-verify-change skill, found 2/);
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
