import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenCodeClient, SessionInfo } from '@opencode/client';
import type { Plugin } from '@opencode/plugin';
import { Service } from '@opencode/client/service';
import { fakeClient } from './fake-client.js';
import { MANAGEMENT_TOOL, workerPermissions } from '../src/workers.js';
import { OpenCodeAdapter, assertHostingServer, connectToHost, resolveOriginModel, type Assignment } from '../src/opencode.js';

const a: Assignment={sessionId:'ses_a',inputId:'msg_a',runId:'run_a',role:'verifier',round:1,agent:'verifier',project:'/tmp/project',
  model:{providerID:'fake',id:'test'},permissions:workerPermissions('verifier'),prompt:'verify'};
function adapterWith(options: {messages?:unknown[]; forms?:unknown[];permissions?:unknown[];outcome?:string;busy?:number;idle?:number;finish?:string;variant?:string}={}) {
  let submissions=0,listed=0;
  const messages=options.messages ?? [
    {type:'user',id:a.inputId,text:a.prompt,time:{created:1}},
    {type:'assistant',id:'answer',agent:a.agent,model:{...a.model,...(options.variant?{variant:options.variant}:{})},finish:options.finish ?? 'stop',time:{created:2,completed:3},content:[{type:'text',text:'{}'}]},
    {type:'idle',id:'end',outcome:options.outcome ?? 'succeeded',time:{created:4}},
  ];
  const client={
    session:{get:async()=>({agent:a.agent,model:a.model,location:{directory:a.project},metadata:{openspecVerifyLoop:a.runId,inputId:a.inputId},permissions:workerPermissions(a.role),outcome:options.outcome??'succeeded',time:{busy:options.busy??1,idle:options.idle??4}}),
      inbox:{list:async()=>[]},prompt:async()=>{submissions++;},
      form:{list:async()=>options.forms??[],get:async()=>({state:{status:'pending'}})}},
    message:{list:async()=>{listed++;return {data:messages,cursor:{}};}},permission:{list:async()=>options.permissions??[]},
  } as unknown as OpenCodeClient;
  return {adapter:new OpenCodeAdapter(client),submissions:()=>submissions,listed:()=>listed};
}
test('tool workers inherit the invoking assistant model even after a session model switch', async () => {
  const model = {providerID: 'lmstudio', id: 'recursivesi/flint', variant: 'default'};
  const newer = {providerID: 'other', id: 'different', variant: 'high'};
  const origin = {id: 'parent', model: newer} as SessionInfo;
  const ctx = {session: {context: async ({sessionID}: {sessionID: string}) => {
    assert.equal(sessionID, origin.id);
    return [{type: 'assistant', id: 'invoking', model}, {type: 'model-switched', id: 'switch', model: newer}];
  }}} as unknown as Plugin.Context;
  assert.deepEqual(await resolveOriginModel(ctx, origin, 'invoking'), model);
  assert.deepEqual(await resolveOriginModel(ctx, {...origin, model: undefined}, 'invoking'), model);
  await assert.rejects(resolveOriginModel(ctx, origin, 'missing'), /Cannot identify the invoking model/);
});
test('native commands inherit session selections or session history without guessing a default', async () => {
  const model = {providerID: 'lmstudio', id: 'recursivesi/flint', variant: 'default'};
  const origin = {id: 'parent', model} as SessionInfo;
  let history: unknown[] = [];
  let reads = 0;
  const ctx = {session: {context: async () => {reads++; return history;}}} as unknown as Plugin.Context;
  assert.deepEqual(await resolveOriginModel(ctx, origin), model);
  assert.equal(reads, 0);
  delete origin.model;
  assert.equal(await resolveOriginModel(ctx, origin), undefined);
  // Compaction has its own model; it must not replace the parent agent's model.
  history = [{type: 'assistant', model}, {type: 'compaction', model: {providerID: 'other', id: 'summary'}}];
  assert.deepEqual(await resolveOriginModel(ctx, origin), model);
  history.push({type: 'model-switched', model: {...model, variant: 'high'}});
  assert.deepEqual(await resolveOriginModel(ctx, origin), {...model, variant: 'high'});
});
test('catalog discovery needs neither agent discovery nor a server default model', async () => {
  const client = {
    location: {get: async () => ({})}, server: {info: async () => ({version: '2.2.5'})},
    agent: {list: async () => {throw new Error('Agent discovery unavailable');}}, skill: {list: async () => ({data: []})},
    model: {
      list: async () => ({data: [{id: 'local', providerID: 'lmstudio', enabled: true, variants: [{id: 'default'}]}]}),
      default: async () => {throw new Error('Default resolution must not be needed');},
    },
  } as unknown as OpenCodeClient;
  assert.deepEqual((await new OpenCodeAdapter(client).catalog('/consumer')).models,
    [{id: 'local', providerID: 'lmstudio', enabled: true, variants: ['default']}]);
});
test('submission reconciliation never restarts a completed worker',async()=>{
  const {adapter,submissions}=adapterWith();await adapter.ensurePrompt(a,false);assert.equal(submissions(),0);
  const missing=adapterWith({messages:[]});
  await assert.rejects(missing.adapter.ensurePrompt(a,false),/no automatic resubmission/);
  assert.equal(missing.submissions(),0);
});
test('collects only a completed response for the expected worker input',async()=>{
  assert.equal((await adapterWith().adapter.observe(a)).status,'completed');
  assert.equal((await adapterWith({outcome:'failed'}).adapter.observe(a)).status,'failed');
  assert.equal((await adapterWith({finish:'length'}).adapter.observe(a)).status,'failed');
  assert.equal((await adapterWith({variant:'different'}).adapter.observe(a)).status,'failed');
  const busy=adapterWith({busy:10,idle:4});
  assert.equal((await busy.adapter.observe(a)).status,'running');
  assert.equal(busy.listed(),0,'a busy worker poll does not download the transcript');
  await assert.rejects(adapterWith({messages:[{type:'user',id:'different'}]}).adapter.observe(a),/Unexpected worker input/);
});
test('input other than the loop prompt before submission fails without submitting',async()=>{
  const other=adapterWith({messages:[{type:'user',id:'msg_other',text:'hello'}]});
  await assert.rejects(other.adapter.ensurePrompt(a),/Unexpected input in worker session/);
  const changed=adapterWith({messages:[{type:'user',id:a.inputId,text:'different'}]});
  await assert.rejects(changed.adapter.ensurePrompt(a),/Existing input does not match dispatch/);
  assert.deepEqual([other.submissions(),changed.submissions()],[0,0]);
});
test('an interrupted worker outcome is reported as interrupted',async()=>{
  const observation=await adapterWith({outcome:'interrupted'}).adapter.observe(a);
  assert.equal(observation.status,'interrupted');
});
test('a repeated message cursor or an oversized transcript fails collection',async()=>{
  const repeating={message:{list:async()=>({data:[],cursor:{next:'same'}})}} as unknown as OpenCodeClient;
  await assert.rejects(new OpenCodeAdapter(repeating).messages(a.sessionId),/Repeated message cursor/);
  let page=0;
  const endless={message:{list:async()=>({data:Array.from({length:100},(_,i)=>({type:'assistant',id:`m${page}_${i}`})),cursor:{next:`c${page++}`}})}} as unknown as OpenCodeClient;
  await assert.rejects(new OpenCodeAdapter(endless).messages(a.sessionId),/exceeds collection limit/);
  assert.equal(page,201);
});
test('permission requests and questions become visible awaiting-input outcomes',async()=>{
  assert.equal((await adapterWith({permissions:[{id:'p',action:'shell',resources:['check']}]}).adapter.observe(a)).status,'awaiting_input');
  assert.equal((await adapterWith({forms:[{id:'q',title:'Choose'}]}).adapter.observe(a)).status,'awaiting_input');
});
test('message pagination follows cursors without incompatible order parameters',async()=>{
  const inputs:unknown[]=[];
  const client={message:{list:async(input:{cursor?:string;order?:string})=>{
    inputs.push(input);
    if(!input.cursor)return {data:[{type:'user',id:a.inputId}],cursor:{next:'next'}};
    assert.equal(input.order,undefined);return {data:[{type:'idle',id:'end'}],cursor:{}};
  }}} as unknown as OpenCodeClient;
  const collected=await new OpenCodeAdapter(client).messages(a.sessionId);
  assert.equal(collected.length,2);assert.equal(inputs.length,2);
});
test('a configured endpoint with another scheme, credentials, query or fragment is refused before the token is sent', async () => {
  const ctx = {app: {version: '2.2.5'}, session: {get: async () => ({id: 'origin'})}} as unknown as Plugin.Context;
  for (const server of ['ftp://127.0.0.1:4096', 'http://user:pw@127.0.0.1:4096', 'http://127.0.0.1:4096/?a=1', 'http://127.0.0.1:4096/#x']) {
    await assert.rejects(connectToHost(ctx, 'origin', server), /must be an HTTP\(S\) URL without credentials/, server);
  }
});
test('without a server option, no discoverable service blocks the start and names the option', async t => {
  const discover = Service.discover;
  t.after(() => { Service.discover = discover; });
  Service.discover = (async () => undefined) as typeof Service.discover;
  const ctx = {app: {version: '2.2.5'}, session: {get: async () => ({id: 'origin'})}} as unknown as Plugin.Context;
  await assert.rejects(connectToHost(ctx, 'origin'), (error: any) => error.outcome === 'blocked' && /server option/.test(error.message));
});
test('a catalogue from a server reporting another version is refused with both versions', async () => {
  const {adapter} = fakeClient();
  (adapter.client as any).server.info = async () => ({version: '2.3.0', pid: process.pid});
  await assert.rejects(adapter.catalog('/p'), (error: any) => error.outcome === 'blocked' && /2\.2\.5 is required; server reports 2\.3\.0/.test(error.message));
});
test('recovery client must match the plugin process and originating native session', async () => {
  const origin = {id: 'origin', time: {created: 1}, location: {directory: '/consumer'}, metadata: {key: 'value'}} as unknown as SessionInfo;
  let pid = process.pid, remote: object = {};
  const client = {server: {info: async () => ({version: '2.2.5', pid})},
    session: {get: async () => ({...origin, ...remote})}} as unknown as OpenCodeClient;
  await assertHostingServer('2.2.5', origin, client);
  pid++;
  await assert.rejects(assertHostingServer('2.2.5', origin, client), /not this plugin hosting server/);
  pid = process.pid;
  for (const change of [{location: {directory: '/other'}}, {time: {created: 2}}, {metadata: {key: 'other'}}, {metadata: undefined}]) {
    remote = change;
    await assert.rejects(assertHostingServer('2.2.5', origin, client), /not this plugin hosting server/, JSON.stringify(change));
  }
});
test('worker creation persists and verifies the full per-session permission policy', async () => {
  let stored: any, creations = 0;
  const client = {session: {
    get: async () => {if (!stored) throw {_tag: 'SessionNotFoundError'}; return stored;},
    create: async (input: any) => {creations++; return stored = input;},
  }} as unknown as OpenCodeClient;
  const adapter = new OpenCodeAdapter(client);
  await adapter.ensureSession(a);
  await adapter.ensureSession(a);
  assert.equal(creations, 1);
  assert.deepEqual(stored.permissions, a.permissions);
  assert.equal(stored.parentID, undefined, 'workers do not inherit a conversation');
  stored.permissions = [...a.permissions, {action: 'edit', resource: '*', effect: 'allow'}];
  await assert.rejects(adapter.ensureSession(a), /identity\/configuration mismatch/);
});

for (const representation of ['nested', 'root-subpath', 'nested-subpath'] as const) {
  test(`worker directory validation accepts ${representation} without weakening identity checks`, async () => {
    const assignment = {...a, project: '/repo', directory: '/repo/packages/app'};
    let session: any;
    const client = {session: {
      get: async () => {if (!session) throw {_tag: 'SessionNotFoundError'}; return session;},
      create: async (input: any) => {
        assert.equal(input.location.directory, assignment.directory);
        session = {...input, location: {directory: representation === 'root-subpath' ? '/repo' : assignment.directory},
          ...(representation === 'nested' ? {} : {subpath: 'packages/app'})};
        return session;
      },
    }} as unknown as OpenCodeClient;
    const adapter = new OpenCodeAdapter(client);
    await adapter.ensureSession(assignment);
    await adapter.ensureSession(assignment);
    for (const field of ['model', 'metadata', 'permissions'] as const) {
      const original = session[field];
      session[field] = field === 'model' ? {providerID: 'different', id: 'different'} : field === 'metadata' ? {} : [];
      await assert.rejects(adapter.ensureSession(assignment), /identity\/configuration mismatch/);
      session[field] = original;
    }
    const originalLocation = session.location;
    session.location = {directory: '/different-checkout/packages/app'};
    session.subpath = 'packages/app';
    await assert.rejects(adapter.ensureSession(assignment), /identity\/configuration mismatch/);
    session.location = originalLocation;
    session.subpath = 'packages/other';
    await assert.rejects(adapter.ensureSession(assignment), /identity\/configuration mismatch/);
  });
}
test('worker policies: verifiers cannot edit; no worker can delegate or manage loops; shell is not gated', () => {
  const verifier = workerPermissions('verifier');
  assert(verifier.some(rule => rule.action === 'edit' && rule.effect === 'deny'));
  assert(!workerPermissions('fixer').some(rule => rule.action === 'edit'));
  for (const role of ['verifier', 'fixer'] as const) {
    assert(workerPermissions(role).some(rule => rule.action === 'subagent' && rule.effect === 'deny'));
    assert(workerPermissions(role).some(rule => rule.action === MANAGEMENT_TOOL && rule.effect === 'deny'));
    assert(!workerPermissions(role).some(rule => rule.action === 'shell'));
  }
});

for (const scenario of ['inbox-read', 'inbox-unavailable', 'cancel', 'queued', 'busy', 'active', 'missing', 'interrupt'] as const) {
  test(`interruption confirmation handles ${scenario}`, async () => {
    let reads = 0, interrupts = 0, cancelled = 0;
    const client = {
      session: {
        inbox: {
          list: async () => {
            reads++;
            if ((scenario === 'inbox-read' && reads === 1) || scenario === 'inbox-unavailable') throw new Error('inbox unavailable');
            return scenario === 'cancel' || scenario === 'queued' ? [{id: 'queued-input'}] : [];
          },
          cancel: async () => {cancelled++; if (scenario === 'cancel') throw new Error('cancel failed');},
        },
        interrupt: async (input: any) => {
          interrupts++;
          assert.equal(input.resume, false);
          if (scenario === 'interrupt') throw new Error('interrupt failed');
        },
        get: async () => {
          if (scenario === 'missing') throw {_tag: 'SessionNotFoundError'};
          return {time: scenario === 'busy' ? {busy: 10, idle: 4} : {busy: 1, idle: 4}};
        },
        active: async () => scenario === 'active' ? {[a.sessionId]: {}} : {},
      },
      experimental: {session: {wait: async () => {}}},
    } as unknown as OpenCodeClient;
    const pending = new OpenCodeAdapter(client).interrupt(a);
    if (scenario === 'cancel' || scenario === 'interrupt' || scenario === 'inbox-unavailable') {
      await assert.rejects(pending, /Cannot confirm worker interruption: .*failed|Cannot confirm worker interruption: inbox unavailable/);
    } else {
      assert.equal(await pending, scenario === 'inbox-read' || scenario === 'missing');
    }
    assert.equal(interrupts, 1, 'inbox failure does not skip active-session interruption');
    if (scenario === 'cancel' || scenario === 'queued') assert.equal(cancelled, 1);
  });
}

test('completion between session and transcript reads waits for a terminal session snapshot', async () => {
  const {adapter, submissions} = adapterWith();
  const get = adapter.client.session.get;
  const list = adapter.client.message.list;
  let completed = false;
  adapter.client.session.get = async (...args) => ({...await get(...args), outcome: completed ? 'succeeded' : undefined});
  adapter.client.message.list = async (...args) => {completed = true; return list(...args);};
  assert.equal((await adapter.observe(a)).status, 'running');
  assert.equal((await adapter.observe(a)).status, 'completed');
  assert.equal(submissions(), 0);
});
