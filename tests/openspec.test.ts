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
  const originModel = {providerID: 'lmstudio', id: 'recursivesi/flint', variant: 'default'};
  let catalog: Catalog = await adapter.catalog(f.project);
  catalog = {...catalog,
    agents: catalog.agents.map(agent => ({...agent, model: {providerID: 'fake', id: 'test'}})),
    models: [...catalog.models, {...originModel, enabled: true, variants: ['medium']}]};
  adapter.catalog = async () => catalog;
  const target = await selectTarget(f.project);
  const config = configSchema.parse({stateDir: f.stateDir});
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
test('missing or unavailable parent models never fall back to build or server defaults', async t => {
  const f = await fixture(); t.after(() => rm(f.base, {recursive: true, force: true}));
  const adapter = new FakeAdapter();
  const catalog = await adapter.catalog(f.project);
  adapter.catalog = async () => ({...catalog,
    agents: catalog.agents.map(agent => ({...agent, model: catalog.defaultModel}))});
  const target = await selectTarget(f.project);
  await assert.rejects(pinTarget(target, configSchema.parse({}), adapter), /Cannot inherit.*verifier/);
  await assert.rejects(pinTarget(target, configSchema.parse({verifierModel: 'fake/test'}), adapter), /Cannot inherit.*fixer/);
  await assert.rejects(pinTarget(target, configSchema.parse({}), adapter,
    {originModel: {providerID: 'unavailable', id: 'parent'}}), /Unavailable verifier model/);
  await assert.rejects(pinTarget(target, configSchema.parse({}), adapter,
    {originModel: {providerID: 'fake', id: 'test', variant: 'unsupported'}}), /Unavailable verifier model/);
  const pins = await pinTarget(target, configSchema.parse({verifierModel: 'fake/test#default', fixerModel: 'fake/test'}), adapter,
    {originModel: {providerID: 'unavailable', id: 'parent'}});
  assert.deepEqual(pins.models, {verifier: {providerID: 'fake', id: 'test', variant: 'default'}, fixer: {providerID: 'fake', id: 'test'}});
});
