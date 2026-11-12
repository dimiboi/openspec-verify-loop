import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRegistry, ModelRuntime, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { captureSettings, modelsFor, parseRunId, parseStart } from '../src/pi-context.js';
import { fakeRegistry, model } from './pi-fakes.js';

test('Pi arguments validate names, stores, limits and control identities', () => {
  assert.deepEqual(parseStart(''), {maxRounds: 5});
  assert.deepEqual(parseStart('add-export --store team-specs --max-rounds 3'), {change: 'add-export', store: 'team-specs', maxRounds: 3});
  for (const value of ['a b', 'bad_name', '--wat', '--store ../x', '--max-rounds 0', '--max-rounds NaN', '--max-rounds 1.5', '--max-rounds Infinity']) assert.throws(() => parseStart(value), value);
  assert.equal(parseRunId(''), undefined);
  assert.equal(parseRunId('run_123abc'), 'run_123abc');
  assert.throws(() => parseRunId('run_a run_b'));
});

test('Pi model bridge retains configured auth and refreshes it per request', async () => {
  const fake = fakeRegistry(['one', 'two']);
  const stream = fake.provider.streamSimple;
  fake.provider.streamSimple = function (...args) { assert.equal(this, fake.provider); return stream(...args); };
  const models = await modelsFor(fake.registry, {provider: model.provider, modelId: model.id}, 'high');
  await models.completeSimple(model, {messages: []}, {reasoning: 'high'});
  fake.setKey('refreshed');
  await models.completeSimple(model, {messages: []}, {reasoning: 'high'});
  assert.equal(fake.requests[0]!.options?.apiKey, 'first');
  assert.equal(fake.requests[1]!.options?.apiKey, 'refreshed');
  assert.equal(fake.requests[1]!.options?.headers?.['x-pi'], 'refreshed');
  assert.equal(fake.requests[1]!.options?.env?.PI_TEST_AUTH, 'refreshed');
  assert.equal(fake.requests[1]!.model.baseUrl, 'https://custom.invalid');
  assert.equal(fake.requests[1]!.options?.reasoning, 'high');
  fake.setKey();
  await assert.rejects(modelsFor(fake.registry, {provider: model.provider, modelId: model.id}, 'high'), /authentication/);
  await assert.rejects(modelsFor(fake.registry, {provider: 'missing', modelId: 'x'}, 'high'), /Unavailable/);
});

test('Pi model bridge retains model-specific headers with refreshed credentials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'loop-pi-model-headers-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const runtime = await ModelRuntime.create({modelsPath: null, authPath: join(root, 'auth.json'), refreshOnCreate: false});
  const fake = fakeRegistry(['first reply', 'second reply']);
  runtime.registerProvider(model.provider, {api: model.api, baseUrl: model.baseUrl, apiKey: 'first',
    models: [{...model, headers: {'x-model-route': 'required-route'}}], streamSimple: fake.provider.streamSimple});
  const registry = new ModelRegistry(runtime);
  const selected = registry.find(model.provider, model.id)!;
  const expected = await registry.getApiKeyAndHeaders(selected);
  assert(expected.ok);
  assert.equal(expected.headers?.['x-model-route'], 'required-route');
  const models = await modelsFor(registry, {provider: model.provider, modelId: model.id}, 'high');
  await models.completeSimple(selected, {messages: []});
  await runtime.setRuntimeApiKey(model.provider, 'refreshed');
  await models.completeSimple(selected, {messages: []});
  assert.deepEqual(fake.requests.map(request => request.options?.headers?.['x-model-route']), ['required-route', 'required-route']);
  assert.deepEqual(fake.requests.map(request => request.options?.apiKey), ['first', 'refreshed']);
  registry.unregisterProvider(model.provider);
  await runtime.removeRuntimeApiKey(model.provider);
  registry.registerProvider({...fake.provider, auth: {apiKey: {name: 'Missing credentials', resolve: async () => undefined}}});
  assert.equal((await registry.getApiKeyAndHeaders(registry.find(model.provider, model.id)!)).ok, true);
  await assert.rejects(modelsFor(registry, {provider: model.provider, modelId: model.id}, 'high'), /authentication/);
});

test('Pi capture uses nested cwd, canonical checkout, project instructions and one advertised skill', async t => {
  const root = await mkdtemp(join(tmpdir(), 'loop-pi-context-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  execFileSync('git', ['init', '-q', root]);
  const directory = join(root, 'packages/app');
  await mkdir(directory, {recursive: true});
  await writeFile(join(root, 'AGENTS.md'), 'Preserve unrelated changes.');
  const procedure = join(directory, 'SKILL.md');
  await writeFile(procedure, 'verify procedure');
  const alias = join(root, 'alias'); await symlink(directory, alias);
  const fake = fakeRegistry();
  const ctx = {cwd: alias, model, thinkingLevel: 'high', modelRegistry: fake.registry,
    sessionManager: {getSessionId: () => 'origin'}} as unknown as ExtensionContext;
  const skill = {name: 'skill:openspec-verify-change', source: 'skill', sourceInfo: {path: procedure}};
  const pi = {getCommands: () => [skill]} as unknown as Pick<ExtensionAPI, 'getCommands'>;
  const result = await captureSettings(pi, ctx, join(root, 'agent-state'));
  assert.equal(result.settings.directory, directory.replace(/^\/var\//, '/private/var/'));
  assert.equal(result.settings.checkout, root.replace(/^\/var\//, '/private/var/'));
  assert.match(result.settings.instructions, /Preserve unrelated changes/);
  assert(!JSON.stringify(result.settings).includes('first'));
  await assert.rejects(captureSettings({getCommands: () => []}, ctx), /exactly one/);
  await assert.rejects(captureSettings({getCommands: () => [skill, skill]} as unknown as Pick<ExtensionAPI, 'getCommands'>, ctx), /found 2/);
  const outside = await mkdtemp(join(tmpdir(), 'loop-pi-not-git-')); t.after(() => rm(outside, {recursive: true, force: true}));
  await assert.rejects(captureSettings(pi, {...ctx, cwd: outside}), /Git checkout/);
});
