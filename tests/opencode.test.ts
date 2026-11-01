import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenCodeClient, SessionInfo } from '@opencode/client';
import { workerPermissions } from '../src/workers.js';
import { OpenCodeAdapter, parseModel, assertHostingServer, type Assignment } from '../src/opencode.js';

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
