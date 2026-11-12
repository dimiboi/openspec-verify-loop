import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { getAgentDir, loadProjectContextFiles, type ExtensionAPI, type ExtensionContext, type ModelRegistry } from '@earendil-works/pi-coding-agent';
import { createModels, type Models, type ModelThinkingLevel } from '@earendil-works/pi-ai';
import { projectRoot } from './util.js';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export type PiArguments = {change?: string; store?: string; maxRounds: number};
export type PiSettings = {
  checkout: string; directory: string; origin: string;
  model: {provider: string; modelId: string}; thinkingLevel: ModelThinkingLevel | null;
  procedurePath: string; procedureHash: string; instructions: string;
};

export function parseStart(text: string): PiArguments {
  const {values, positionals} = parseArgs({args: text.trim() ? text.trim().split(/\s+/) : [], allowPositionals: true,
    options: {store: {type: 'string'}, 'max-rounds': {type: 'string'}}});
  if (positionals.length > 1 || (positionals[0] && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(positionals[0]))) {
    throw new Error('Expected at most one kebab-case change name');
  }
  if (values.store !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.store)) throw new Error('Invalid store ID');
  const maxRounds = values['max-rounds'] === undefined ? 5 : Number(values['max-rounds']);
  if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0) throw new Error('maxRounds must be a positive integer');
  return {...(positionals[0] ? {change: positionals[0]} : {}), ...(values.store ? {store: values.store} : {}), maxRounds};
}

export function parseRunId(text: string): string | undefined {
  const id = text.trim();
  if (id && !/^run_[a-f0-9]+$/.test(id)) throw new Error('Expected one run ID, as shown by start or report');
  return id || undefined;
}

export type PiModels = Pick<ModelRegistry, 'find' | 'getProvider' | 'getProviderAuth' | 'getApiKeyAndHeaders'>;

/** Keep Pi's configured provider and ask its auth resolver afresh on every request. */
export async function modelsFor(registry: PiModels, ref: PiSettings['model'], thinkingLevel: ModelThinkingLevel | null): Promise<Models> {
  const model = registry.find(ref.provider, ref.modelId);
  const provider = registry.getProvider(ref.provider);
  if (!model || !provider || !provider.getModels().some(m => m.id === ref.modelId)) {
    throw new Error(`Unavailable Pi model ${ref.provider}/${ref.modelId}`);
  }
  if (thinkingLevel !== null && (model.thinkingLevelMap?.[thinkingLevel] === null || (!model.reasoning && thinkingLevel !== 'off'))) {
    throw new Error(`Unavailable thinking level ${thinkingLevel} for ${ref.provider}/${ref.modelId}`);
  }
  const resolve = async () => {
    // The model-aware helper also succeeds for unauthenticated compatibility requests.
    if (!await registry.getProviderAuth(ref.provider)) throw new Error(`Unresolved Pi authentication for ${ref.provider}`);
    const resolved = await registry.getApiKeyAndHeaders(model);
    if (!resolved.ok) throw new Error(`Unresolved Pi authentication for ${ref.provider}: ${resolved.error}`);
    return {auth: {apiKey: resolved.apiKey, headers: resolved.headers, baseUrl: resolved.baseUrl}, env: resolved.env};
  };
  await resolve();
  const models = createModels();
  models.setProvider({...provider, id: provider.id, name: provider.name, baseUrl: provider.baseUrl, headers: provider.headers,
    getModels: () => [model], stream: provider.stream.bind(provider), streamSimple: provider.streamSimple.bind(provider),
    fetchDeferred: provider.fetchDeferred?.bind(provider), cancelDeferred: provider.cancelDeferred?.bind(provider),
    auth: {apiKey: {name: 'Invoking Pi session', resolve}}});
  return models;
}

export async function captureSettings(pi: Pick<ExtensionAPI, 'getCommands'>, ctx: ExtensionContext,
  agentDir = getAgentDir()): Promise<{settings: PiSettings; models: Models}> {
  const directory = await realpath(ctx.cwd);
  const checkout = await projectRoot(directory);
  if (!ctx.model) throw new Error('Cannot identify the invoking model; select a Pi model');
  const skills = pi.getCommands().filter(command => command.source === 'skill' &&
    (command.name === 'skill:openspec-verify-change' || command.name.startsWith('skill:openspec-verify-change:')));
  if (skills.length !== 1) throw new Error(`Expected exactly one openspec-verify-change skill, found ${skills.length}: ${skills.map(s => s.sourceInfo.path).join(', ')}`);
  const procedurePath = await realpath(skills[0]!.sourceInfo.path);
  const model = {provider: ctx.model.provider, modelId: ctx.model.id};
  const models = await modelsFor(ctx.modelRegistry, model, ctx.thinkingLevel ?? null);
  const instructions = loadProjectContextFiles({cwd: directory, agentDir})
    .map(file => `Project instructions from ${file.path}:\n${file.content}`).join('\n\n');
  return {models, settings: {checkout, directory, origin: ctx.sessionManager.getSessionId(), model,
    thinkingLevel: ctx.thinkingLevel ?? null, procedurePath, procedureHash: hash(await readFile(procedurePath, 'utf8')), instructions}};
}
