import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRegistry, ModelRuntime, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { captureSettings, modelsFor, parseRunId, parseStart } from '../src/pi-context.js';
import { fakeRegistry, model } from './pi-fakes.js';

test('Pi start arguments preserve omitted keys, defaults and numeric conversion', () => {
  assert.deepEqual(parseStart(''), {maxRounds: 5});
  assert.deepEqual(parseStart(' \t '), {maxRounds: 5});
  assert.deepEqual(parseStart('add-export'), {change: 'add-export', maxRounds: 5});
  assert.deepEqual(parseStart('--store Team_1.specs-2'), {store: 'Team_1.specs-2', maxRounds: 5});
  assert.deepEqual(parseStart('add-export --store team-specs --max-rounds 3'), {change: 'add-export', store: 'team-specs', maxRounds: 3});
  for (const [value, expected] of [['1', 1], ['1e2', 100], ['0x10', 16], ['03', 3], ['+2', 2], ['3.0', 3], ['9007199254740991', Number.MAX_SAFE_INTEGER]] as const) {
    assert.deepEqual(parseStart(`--max-rounds=${value}`), {maxRounds: expected});
  }
});

test('Pi start arguments keep field errors and validation order after parseArgs', () => {
  const changeError = {message: 'Expected at most one kebab-case change name'};
  const storeError = {message: 'Invalid store ID'};
  const limitError = {message: 'maxRounds must be a positive integer'};
  for (const value of ['a b', 'bad_name', 'Bad', '-bad', 'bad-', 'bad--name', '../change', '"add-export"']) {
    assert.throws(() => parseStart(`-- ${value}`), changeError, value);
  }
  for (const value of ['', '../x', '-bad', '.bad', 'a/b']) {
    assert.throws(() => parseStart(`--store=${value}`), storeError, value);
  }
  for (const value of ['', '0', '-1', 'NaN', '1.5', 'Infinity', '9007199254740992', '1e100']) {
    assert.throws(() => parseStart(`--max-rounds=${value}`), limitError, value);
  }
  assert.throws(() => parseStart('bad_name --store=../bad --max-rounds=0'), changeError);
  assert.throws(() => parseStart('one two --store=../bad --max-rounds=0'), changeError);
  assert.throws(() => parseStart('add-export --store=../bad --max-rounds=0'), storeError);
  assert.throws(() => parseStart('add-export --store=team --max-rounds=0'), limitError);
  assert.throws(() => parseStart('bad_name --wat'), {code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION'});
  for (const value of ['--store', '--max-rounds']) {
    assert.throws(() => parseStart(value), {code: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE'});
  }
});

test('Pi control arguments validate run identities', () => {
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
