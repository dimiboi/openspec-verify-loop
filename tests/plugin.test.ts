import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { setupPlugin, protectContext } from '../src/plugin.js';
import { commandActions, parseCommand } from '../src/commands.js';
import { resolveConfig } from '../src/config.js';
import { MANAGEMENT_TOOL, workerPermissions } from '../src/workers.js';
import { LoopService } from '../src/service.js';
import { RunManager } from '../src/manager.js';

type Definition = {name: string; execute(input: any, context?: any): Promise<any>};
function fakeHost(stateDir: string) {
  const commands: Definition[] = [], tools: Definition[] = [], skills: any[] = [], notices: any[] = [];
  let disposals = 0, assertions = 0;
  let history: any[] = [];
  const register = async (callback: (editor: any) => void, entries: any[]) => {
    callback({add: (entry: any) => entries.push(entry)});
    let disposed = false;
    return {dispose: async () => { if (!disposed) {disposed = true; disposals++;} }};
  };
  const ctx = {
    app: {version: '2.2.5'}, location: {directory: '/unrelated/plugin-instance'}, options: {stateDir},
    session: {
      get: async ({sessionID}: {sessionID: string}) => ({id: sessionID, location: {directory: process.cwd()},
        metadata: sessionID === 'worker' ? {openspecVerifyLoop: 'run_fake'} : {}}),
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

test('native command grammar validates targets and never accepts shell fragments', () => {
  assert.deepEqual(parseCommand('verify-loop', ''), {action: 'run'});
  assert.deepEqual(parseCommand('verify-loop', 'add-export'), {action: 'run', change: 'add-export'});
  assert.deepEqual(parseCommand('verify-loop-status', ''), {action: 'status'});
  assert.deepEqual(parseCommand('verify-loop-resume', 'run_ab12'), {action: 'resume', runId: 'run_ab12'});
  for (const value of ['add-export;rm', '$(cmd)', '--help', 'one two', '../change']) assert.throws(() => parseCommand('verify-loop', value));
  assert.throws(() => parseCommand('verify-loop-stop', ''));
  assert.throws(() => parseCommand('verify-loop-resume', '../run_ab12'));
});
test('plugin options reject unknown fields and duplicate checks and resolve against the consuming project', () => {
  assert.throws(() => resolveConfig({unknown: true}, '/consumer'));
  assert.throws(() => resolveConfig({checks: [{id: 'tests', command: ['test']}, {id: 'tests', command: ['test']}]}, '/consumer'));
  const config = resolveConfig({stateDir: '../state', skill: '.agents/skills/verify/SKILL.md'}, '/consumer');
  assert.equal(config.stateDir, '/state');
  assert.equal(config.skill, '/consumer/.agents/skills/verify/SKILL.md');
});
test('native registrations load packaged instructions and commands/tools share the management service', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'loop-host-fake-')); t.after(() => rm(stateDir, {recursive: true, force: true}));
  const host = fakeHost(stateDir);
  const cleanup = await setupPlugin(host.ctx);
  assert.deepEqual(host.commands.map(command => command.name), Object.keys(commandActions));
  assert.equal(host.tools[0]?.name, MANAGEMENT_TOOL);
  assert.equal((host.tools[0] as any).input.type, 'object');
  assert.equal((host.tools[0] as any).input.oneOf, undefined);
  assert.match(host.skills[0].content, /openspec_verify_loop/);
  assert.match(host.skills[0].path, /skills\/openspec-verify-loop\/SKILL.md$/);
  await host.commands.find(command => command.name === 'verify-loop-status')!.execute({sessionID: 'parent', prompt: {text: ''}});
  assert.match(host.notices[0].text, /"outcome":"status"/);
  assert.equal(host.notices[0].resume, true);
  const result = await host.tools[0]!.execute({action: 'status'}, {sessionID: 'parent'});
  assert.equal(JSON.parse(result.content).outcome, 'status');
  await assert.rejects(host.tools[0]!.execute({action: 'run'}, {sessionID: 'worker'}), /workers cannot/);
  assert.equal(host.assertions(), 0, 'worker rejection precedes approval and dispatch');
  await cleanup();
  await cleanup();
  assert.equal(host.disposals(), 4);
});
test('owned workers cannot enter the service; reporting turns have no tools while ordinary turns keep them', async () => {
  const host = fakeHost('/unused');
  const manager = new RunManager();
  const service = new LoopService(host.ctx, manager);
  await assert.rejects(service.execute('worker', {action: 'status'}), /workers cannot/);
  const event = () => ({sessionID: 'parent', tools: {[MANAGEMENT_TOOL]: {}, read: {}}, system: []}) as any;
  let context = event(); await protectContext(host.ctx, context);
  assert('read' in context.tools); assert(MANAGEMENT_TOOL in context.tools);
  host.history([{type: 'synthetic', metadata: {openspecLoopNotice: true}}]);
  context = event(); await protectContext(host.ctx, context);
  assert.deepEqual(context.tools, {}); assert.equal(context.system.length, 1);
  context = event(); context.sessionID = 'worker'; await protectContext(host.ctx, context);
  assert('read' in context.tools); assert(!(MANAGEMENT_TOOL in context.tools));
  await manager.close();
});
test('worker policies retain edit/delegation restrictions and controlled shell access', () => {
  const verifier = workerPermissions('verifier');
  assert(verifier.some(rule => rule.action === 'edit' && rule.effect === 'deny'));
  assert(verifier.some(rule => rule.action === 'shell' && rule.resource === '*' && rule.effect === 'ask'));
  for (const role of ['verifier', 'fixer'] as const) {
    assert(workerPermissions(role).some(rule => rule.action === 'subagent' && rule.effect === 'deny'));
    assert(workerPermissions(role).some(rule => rule.action === MANAGEMENT_TOOL && rule.effect === 'deny'));
  }
  const deny = {action: 'shell', resource: 'git status*', effect: 'deny' as const};
  const restricted = workerPermissions('verifier', [deny]);
  assert(restricted.indexOf(deny) > restricted.findIndex(rule => rule.resource === 'git status*' && rule.effect === 'allow'));
  const broadAsk = {action: '*', resource: '*', effect: 'ask' as const};
  const strict = workerPermissions('verifier', [broadAsk]);
  assert(strict.findIndex(rule => rule.action === 'edit' && rule.effect === 'deny') > strict.indexOf(broadAsk));
});
