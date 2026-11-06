import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { RunManager } from '../src/manager.js';
import { LoopService } from '../src/service.js';
import { fakeClient, until } from './fake-client.js';
import { projectRoot } from '../src/util.js';

for (const representation of ['nested', 'root-subpath', 'nested-subpath', 'alias'] as const) {
  test(`nested project discovery and checkout ownership survive ${representation}`, async t => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), 'verify-loop-context-')));
    t.after(() => rm(temporary, {recursive: true, force: true}));
    const root = join(temporary, 'repo'), app = join(root, 'packages', 'app'), sibling = join(root, 'packages', 'other');
    await mkdir(join(app, 'openspec', 'changes', 'add-app'), {recursive: true});
    await mkdir(sibling);
    await writeFile(join(app, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
    await writeFile(join(app, 'openspec', 'changes', 'add-app', 'tasks.md'), '- [ ] Nested app task\n');
    execFileSync('git', ['init', root], {stdio: 'pipe'});
    const alias = join(temporary, 'alias');
    await symlink(root, alias, 'dir');
    const originDirectory = representation === 'root-subpath' ? root
      : representation === 'alias' ? join(alias, 'packages', 'app') : app;
    const model = {providerID: 'fake', id: 'test', variant: 'high'};
    const ctx = {options: {}, location: {directory: '/unrelated/plugin'}, session: {
      get: async ({sessionID}: {sessionID: string}) => ({id: sessionID, metadata: {}, model,
        location: {directory: sessionID === 'sibling' ? sibling : sessionID === 'alias' ? join(alias, 'packages', 'app') : originDirectory},
        ...(sessionID === 'parent' && representation.includes('subpath') ? {subpath: 'packages/app'} : {}),
      }),
    }} as unknown as Plugin.Context;
    const fake = fakeClient({hold: true}), lookups: string[] = [];
    const catalog = fake.adapter.catalog.bind(fake.adapter);
    fake.adapter.catalog = async directory => {lookups.push(directory); return catalog(directory);};
    const notices: Record<string, unknown>[] = [];
    const manager = new RunManager(async (_session, result) => {notices.push(result);});
    const service = new LoopService(ctx, manager, async () => ({adapter: fake.adapter}), 1);
    await service.execute('parent', {action: 'run', change: 'add-app'});
    await until(() => fake.stats.prompts === 1);
    assert.equal(lookups[0], app, 'catalogues use the invoking project');
    assert.equal(fake.stats.created[0].location.directory, app);
    assert.match(await readFile(join(fake.stats.created[0].location.directory, 'openspec', 'changes', 'add-app', 'tasks.md'), 'utf8'), /Nested app task/);
    await assert.rejects(service.execute('sibling', {action: 'run', change: 'add-app'}), /already running/);
    const interrupt = fake.adapter.interrupt.bind(fake.adapter);
    fake.adapter.interrupt = async () => false;
    assert.equal((await service.execute('parent', {action: 'stop'})).outcome, 'failed');
    await assert.rejects(service.execute('sibling', {action: 'run'}), /reserved for worker/);
    await assert.rejects(service.execute('alias', {action: 'run'}), /reserved for worker/);
    fake.adapter.interrupt = interrupt;
    assert.equal((await service.execute('sibling', {action: 'stop'})).outcome, 'stopped');
    assert.equal(fake.stats.created.length, 1);
    assert.equal(fake.stats.created[0].location.directory, app, 'sibling cleanup keeps the original context');
    assert.equal(fake.stats.prompts, 1);
    assert.equal(notices.length, 1);
    await manager.close();
  });
}

for (const startingSession of ['direct', 'root-subpath'] as const) {
  test(`a nested Git checkout shares its reservation when started from ${startingSession}`, async t => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), 'verify-loop-nested-git-')));
    const root = join(temporary, 'repo'), app = join(root, 'packages', 'app');
    const fake = fakeClient({hold: true});
    const interrupt = fake.adapter.interrupt.bind(fake.adapter);
    const manager = new RunManager(async () => {});
    t.after(async () => {
      fake.adapter.interrupt = interrupt;
      await manager.close();
      await rm(temporary, {recursive: true, force: true});
    });
    await mkdir(app, {recursive: true});
    for (const directory of [root, app]) execFileSync('git', ['init', directory], {stdio: 'pipe'});
    const model = {providerID: 'fake', id: 'test', variant: 'high'};
    const ctx = {options: {}, session: {
      get: async ({sessionID}: {sessionID: string}) => ({id: sessionID, metadata: {}, model,
        location: {directory: sessionID === 'root-subpath' ? root : app},
        ...(sessionID === 'root-subpath' ? {subpath: 'packages/app'} : {}),
      }),
    }} as unknown as Plugin.Context;
    const service = new LoopService(ctx, manager, async () => ({adapter: fake.adapter}), 1);
    const otherSession = startingSession === 'direct' ? 'root-subpath' : 'direct';
    await service.execute(startingSession, {action: 'run', change: 'add-app'});
    await until(() => fake.stats.prompts === 1);
    await assert.rejects(service.execute(otherSession, {action: 'run'}), /already running/);
    fake.adapter.interrupt = async () => false;
    assert.equal((await service.execute(otherSession, {action: 'stop'})).outcome, 'failed');
    await assert.rejects(service.execute(otherSession, {action: 'run'}), /reserved for worker/);
    fake.adapter.interrupt = interrupt;
    assert.equal((await service.execute(otherSession, {action: 'stop'})).outcome, 'stopped');
    assert.equal(fake.stats.created.length, 1);
    assert.equal(fake.stats.created[0].location.directory, app);
    assert.equal(fake.stats.prompts, 1);
    assert.equal(fake.stats.interrupts, 1);
    assert.equal((await service.execute(startingSession, {action: 'stop'})).outcome, 'not_running');
  });
}

test('a directory outside any Git checkout is refused as blocked', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loop-not-git-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await assert.rejects(projectRoot(dir), (error: any) => error.outcome === 'blocked' && /must be a Git checkout/.test(error.message));
});
