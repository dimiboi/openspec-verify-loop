import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import plugin from '../src/pi.js';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

test('loading the Pi entry only registers commands and lifecycle handlers', () => {
  const pi = new Proxy({}, {get: (_target, key) => {
    assert(['on', 'registerCommand'].includes(String(key)), `Loading accessed ${String(key)}`);
    return () => {};
  }}) as ExtensionAPI;
  assert.equal(plugin(pi), undefined);
});

test('Pi native commands report validation errors without starting a model turn', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-loop-entry-')); t.after(() => rm(cwd, {recursive: true, force: true}));
  execFileSync('git', ['init', '-q', cwd]);
  const commands = new Map<string, {handler: (text: string, ctx: ExtensionContext) => Promise<void>}>();
  const messages: unknown[][] = [];
  const pi = {registerCommand: (name: string, command: {handler: (text: string, ctx: ExtensionContext) => Promise<void>}) => commands.set(name, command),
    on: () => {}, getCommands: () => [], sendMessage: (...args: unknown[]) => messages.push(args)} as unknown as ExtensionAPI;
  plugin(pi);
  assert.deepEqual([...commands.keys()], ['opsx-verify-loop', 'opsx-verify-loop-report', 'opsx-verify-loop-stop', 'opsx-verify-loop-resume']);
  await commands.get('opsx-verify-loop')!.handler('invalid_name', {cwd} as ExtensionContext);
  await commands.get('opsx-verify-loop-report')!.handler('', {cwd} as ExtensionContext);
  assert.equal(messages.length, 2);
  for (const args of messages) assert.deepEqual(args[1], {triggerTurn: false});
  assert.match(JSON.stringify(messages), /kebab-case/);
  assert.match(JSON.stringify(messages), /No unfinished loop/);
});
