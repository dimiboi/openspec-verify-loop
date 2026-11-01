import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { fixture, FakeAdapter } from './fixtures.js';
import { checkPins, pinTarget, selectTarget } from '../src/openspec.js';
import { configSchema } from '../src/config.js';
import type { Catalog } from '../src/opencode.js';

test('origin models are pinned independently of later defaults and worker policy drift is rejected', async t => {
  const f = await fixture(); t.after(() => rm(f.base, {recursive: true, force: true}));
  const adapter = new FakeAdapter();
  let catalog: Catalog = await adapter.catalog(f.project);
  adapter.catalog = async () => catalog;
  const target = await selectTarget(f.project);
  const config = configSchema.parse({stateDir: f.stateDir});
  const originModel = {providerID: 'fake', id: 'test', variant: 'default'};
  const pins = await pinTarget(target, config, adapter, {originModel});
  assert.deepEqual(pins.models, {verifier: originModel, fixer: originModel});
  assert.deepEqual(pins.agents, {verifier: 'build', fixer: 'build'});
  catalog = {...catalog, defaultModel: {providerID: 'other', id: 'new-default'}};
  await checkPins(pins, config, adapter);
  catalog = {...catalog, agents: catalog.agents.map(agent => ({...agent,
    permissions: [...agent.permissions, {action: 'shell', resource: 'git status*', effect: 'deny'}]}))};
  await assert.rejects(checkPins(pins, config, adapter), /Pinned/);
  catalog = {...catalog, models: catalog.models.map(model => ({...model, enabled: false}))};
  await assert.rejects(pinTarget(target, config, adapter, {originModel}), /Unavailable verifier model/);
});
