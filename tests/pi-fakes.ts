import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model, type Provider, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import type { PiModels } from '../src/pi-context.js';

export const model: Model<Api> = {id: 'fake', name: 'Fake', provider: 'test', api: 'openai-completions', baseUrl: 'https://example.invalid',
  reasoning: true, input: ['text'], contextWindow: 100_000, maxTokens: 8000,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};
export const answer = (text: string, stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage => ({
  role: 'assistant', content: [{type: 'text', text}], api: model.api, provider: model.provider, model: model.id,
  usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
  stopReason, timestamp: Date.now(),
});

type Events = ReturnType<typeof createAssistantMessageEventStream>;
export function fakeRegistry(replies: (string | ((context: TranscriptContext, options?: SimpleStreamOptions, events?: Events) => Promise<AssistantMessage>))[] = []) {
  const requests: {model: Model<Api>; context: TranscriptContext; options?: SimpleStreamOptions}[] = [];
  let key: string | undefined = 'first';
  let authCalls = 0;
  const stream: Provider['streamSimple'] = (_model, context, options) => {
    const events = createAssistantMessageEventStream();
    const reply = replies[requests.length];
    requests.push({model: _model, context, options});
    events.push({type: 'start', partial: answer('')});
    void Promise.resolve().then(async () => {
      const message = typeof reply === 'function' ? await reply(context, options, events) : answer(reply ?? 'No fake reply');
      events.push({type: 'done', reason: 'stop', message});
      events.end(message);
    });
    return events;
  };
  const provider: Provider = {id: model.provider, name: 'Fake', baseUrl: model.baseUrl,
    auth: {apiKey: {name: 'Fake', resolve: async () => ({auth: {apiKey: key}})}},
    getModels: () => [model], stream: (m, c, o) => stream(m, c, o as SimpleStreamOptions), streamSimple: stream};
  const registry: PiModels = {find: (p, id) => p === model.provider && id === model.id ? model : undefined,
    getProvider: p => p === model.provider ? provider : undefined,
    getProviderAuth: async () => key ? {auth: {apiKey: key}} : undefined,
    getApiKeyAndHeaders: async () => { authCalls++; return key
      ? {ok: true, apiKey: key, headers: {'x-pi': key}, baseUrl: 'https://custom.invalid', env: {PI_TEST_AUTH: key}}
      : {ok: false, error: 'Missing credentials'}; }};
  return {registry, requests, provider, setKey: (value?: string) => {key = value;}, authCalls: () => authCalls};
}
