import type { OpenCodeClient } from '@opencode/client';
import { OpenCodeAdapter } from '../src/opencode.js';

export type FakeOptions = {
  replies?: string[];
  /** `lost`: the prompt is stored but the call errors; `invisible`: the call errors and nothing is stored. */
  promptFails?: 'lost' | 'invisible';
  /** Keep workers running until interrupted. */
  hold?: boolean;
  permissions?: unknown[];
  skills?: {id: string; name: string; path: string}[];
  models?: {id: string; providerID: string; enabled: boolean; variants: {id: string}[]}[];
};

/** An in-memory OpenCode 2.2.5 client, enough for OpenCodeAdapter to run workers. */
export function fakeClient(options: FakeOptions = {}) {
  const sessions = new Map<string, any>();
  const messages = new Map<string, any[]>();
  const replies = [...(options.replies ?? [])];
  const stats = {prompts: 0, interrupts: 0, created: [] as any[]};
  const complete = (sessionID: string) => {
    const session = sessions.get(sessionID);
    messages.get(sessionID)!.push(
      {type: 'assistant', id: `answer_${sessionID}`, agent: session.agent, model: session.model, finish: 'stop',
        time: {created: 2, completed: 3}, content: [{type: 'text', text: replies.shift() ?? 'VERDICT: CLEAN'}]},
      {type: 'idle', id: `idle_${sessionID}`, outcome: 'succeeded', time: {created: 4}});
    session.outcome = 'succeeded';
    session.time = {busy: 1, idle: 4};
  };
  const client = {
    location: {get: async () => ({})},
    server: {info: async () => ({version: '2.2.5', pid: process.pid})},
    agent: {list: async () => ({data: [{id: 'build', mode: 'primary', permissions: []}]})},
    skill: {list: async () => ({data: options.skills ?? [{id: 'openspec-verify-change', name: 'openspec-verify-change', path: '/p/.opencode/skills/openspec-verify-change/SKILL.md'}]})},
    model: {list: async () => ({data: options.models ?? [{id: 'test', providerID: 'fake', enabled: true, variants: [{id: 'high'}]}]})},
    session: {
      get: async ({sessionID}: {sessionID: string}) => {
        const session = sessions.get(sessionID);
        if (!session) throw {_tag: 'SessionNotFoundError'};
        return session;
      },
      create: async (input: any) => {
        const session = {...input, time: {busy: 0, idle: 0}};
        stats.created.push(session);
        sessions.set(input.id, session);
        messages.set(input.id, []);
        return session;
      },
      prompt: async ({sessionID, id, text}: {sessionID: string; id: string; text: string}) => {
        stats.prompts++;
        if (options.promptFails === 'invisible') throw new Error('connection reset');
        messages.get(sessionID)!.push({type: 'user', id, text, time: {created: 1}});
        sessions.get(sessionID).time = {busy: 5, idle: 0};
        if (!options.hold) complete(sessionID);
        if (options.promptFails === 'lost') throw new Error('response lost');
      },
      inbox: {list: async () => [], cancel: async () => {}},
      form: {list: async () => [], get: async () => ({state: {status: 'pending'}})},
      interrupt: async ({sessionID}: {sessionID: string}) => {
        stats.interrupts++;
        sessions.get(sessionID).time = {busy: 1, idle: 4};
      },
      active: async () => ({}),
    },
    experimental: {session: {wait: async () => {}}},
    message: {list: async ({sessionID}: {sessionID: string}) => ({data: messages.get(sessionID) ?? [], cursor: {}})},
    permission: {list: async () => options.permissions ?? []},
  } as unknown as OpenCodeClient;
  return {adapter: new OpenCodeAdapter(client), stats};
}

export async function until(condition: () => boolean) {
  for (let i = 0; i < 2000 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 2));
  if (!condition()) throw new Error('condition not reached');
}
