import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenCodeClient, SessionInfo } from '@opencode/client';
import type { Plugin } from '@opencode/plugin';
import { workerPermissions } from '../src/workers.js';
import { OpenCodeAdapter, parseModel, assertHostingServer, resolveOriginModel, type Assignment } from '../src/opencode.js';

const a: Assignment={sessionId:'ses_a',inputId:'msg_a',runId:'run_a',role:'verifier',round:1,agent:'verifier',project:'/tmp/project',
  model:{providerID:'fake',id:'test'},permissions:workerPermissions('verifier'),prompt:'verify'};
function adapterWith(options: {messages?:unknown[]; forms?:unknown[];permissions?:unknown[];outcome?:string;busy?:number;idle?:number;finish?:string;variant?:string}={}) {
  let submissions=0;
  const messages=options.messages ?? [
    {type:'user',id:a.inputId,text:a.prompt,time:{created:1}},
    {type:'assistant',id:'answer',agent:a.agent,model:{...a.model,...(options.variant?{variant:options.variant}:{})},finish:options.finish ?? 'stop',time:{created:2,completed:3},content:[{type:'text',text:'{}'}]},
    {type:'idle',id:'end',outcome:options.outcome ?? 'succeeded',time:{created:4}},
  ];
  const client={
    session:{get:async()=>({agent:a.agent,model:a.model,location:{directory:a.project},metadata:{openspecVerifyLoop:a.runId,inputId:a.inputId},permissions:workerPermissions(a.role),outcome:options.outcome??'succeeded',time:{busy:options.busy??1,idle:options.idle??4}}),
      inbox:{list:async()=>[]},prompt:async()=>{submissions++;},
      form:{list:async()=>options.forms??[],get:async()=>({state:{status:'pending'}})}},
    message:{list:async()=>({data:messages,cursor:{}})},permission:{list:async()=>options.permissions??[]},
  } as unknown as OpenCodeClient;
  return {adapter:new OpenCodeAdapter(client),submissions:()=>submissions};
}
test('model references preserve nested model IDs and explicit variants',()=>{
  assert.deepEqual(parseModel('openrouter/vendor/model#high'),{providerID:'openrouter',id:'vendor/model',variant:'high'});
  assert.throws(()=>parseModel('missing-provider'));assert.throws(()=>parseModel('provider/model#'));
});
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
test('catalog discovery does not resolve a server default model', async () => {
  const client = {
    location: {get: async () => ({})}, server: {info: async () => ({version: '2.2.5'})},
    agent: {list: async () => ({data: []})}, skill: {list: async () => ({data: []})},
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
  assert.equal((await adapterWith({busy:10,idle:4}).adapter.observe(a)).status,'running');
  await assert.rejects(adapterWith({messages:[{type:'user',id:'different'}]}).adapter.observe(a),/Unexpected worker input/);
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
test('recovery client must match the plugin process and originating native session', async () => {
  const origin = {id: 'origin', time: {created: 1}, location: {directory: '/consumer'}, metadata: {key: 'value'}} as unknown as SessionInfo;
  let pid = process.pid, directory = '/consumer';
  const client = {server: {info: async () => ({version: '2.2.5', pid})},
    session: {get: async () => ({...origin, location: {directory}})}} as unknown as OpenCodeClient;
  await assertHostingServer('2.2.5', origin, client);
  pid++;
  await assert.rejects(assertHostingServer('2.2.5', origin, client), /not this plugin hosting server/);
  pid = process.pid; directory = '/other';
  await assert.rejects(assertHostingServer('2.2.5', origin, client), /not this plugin hosting server/);
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
