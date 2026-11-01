import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRun, resumeRun, stopRun } from '../src/controller.js';
import { configSchema } from '../src/config.js';
import { RunStore, loadRun } from '../src/state.js';
import { selectTarget } from '../src/openspec.js';
import { command, exists } from '../src/util.js';
import { fixtureConfig, fixture, FakeAdapter, verifier, fixer, findings, priorIds, resolveAll } from './fixtures.js';

test('clean first verifier saves evidence and never creates a fixer',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter();
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir,checks:[{id:'tests',command:['node','--test','greet.test.mjs']}]}),adapter,undefined,{lockRoot:f.lockRoot,pollMs:1});
  assert.equal(s.phase,'clean');assert.equal(adapter.creations,1);assert.equal(adapter.seen[0]!.role,'verifier');
  const final=JSON.parse(await readFile(join(s.runDir,'final.json'),'utf8'));
  assert.equal(final.outcome,'clean');
  assert(await exists(join(s.runDir,'rounds/001/verifier.json')));
  const checks=JSON.parse(await readFile(join(s.runDir,'rounds/001/checks.json'),'utf8'));
  const report=JSON.parse(await readFile(join(s.runDir,'rounds/001/verifier.json'),'utf8'));
  assert.equal(checks.workspace,report.workspace);
  assert.equal(checks.validation.exitCode,0);assert.equal(checks.checks[0].exitCode,0);
  assert(checks.checks[0].stdout.length>0);
});
test('full verify/fix/verify passes every severity and uses three fresh sessions',async t=>{
  const f=await fixture({broken:true});t.after(()=>rm(f.base,{recursive:true,force:true}));
  const projectConfig=join(f.project,'openspec/config.yaml');
  await writeFile(projectConfig,(await readFile(projectConfig,'utf8'))+'\ncontext: Keep named greetings deterministic.\n');
  await writeFile(join(f.project,'unrelated.txt'),'preserve me');
  const adapter=new FakeAdapter(async a=>{
    if(a.role==='fixer') {
      assert(a.prompt.includes('Keep named greetings deterministic.'));
      for(const finding of findings) assert(a.prompt.includes(finding.id));
      await writeFile(join(f.project,'greet.mjs'),'export function greet(name) { return `Hello, ${name}!`; }\n');
      return {status:'completed',text:JSON.stringify(fixer(a)),messageId:'fix'};
    }
    const r=a.round===1?verifier(a,{outcome:'findings',findings}):verifier(a,{priorFindingResolutions:resolveAll(a)});
    return {status:'completed',text:JSON.stringify(r),messageId:`verify-${a.round}`};
  });
  const originModel = {providerID:'lmstudio',id:'recursivesi/flint',variant:'default'};
  const catalog = await adapter.catalog(f.project);
  adapter.catalog = async () => ({...catalog, models:[...catalog.models,{...originModel,enabled:true,variants:['default']}]});
  const events: any[] = [];
  const s=await createRun(f.project,configSchema.parse({stateDir:f.stateDir,checks:[{id:'test',command:['node','--test','greet.test.mjs']}]}),adapter,undefined,{lockRoot:f.lockRoot,pollMs:1,originModel,emit:event=>events.push(event)});
  assert.equal(s.phase,'clean',s.reason ?? '');assert.equal(adapter.creations,3);assert.equal(new Set(adapter.seen.map(a=>a.sessionId)).size,3);
  assert.deepEqual(adapter.seen.map(a=>a.role),['verifier','fixer','verifier']);
  assert(adapter.seen.every(a=>JSON.stringify(a.model)===JSON.stringify(originModel)));
  const models = {verifier:originModel,fixer:originModel};
  assert.deepEqual(events.find(event=>event.event==='started').models,models);
  assert.deepEqual(JSON.parse(await readFile(join(s.runDir,'final.json'),'utf8')).models,models);
  assert.match(await readFile(join(s.runDir,'final.md'),'utf8'),/verifier: lmstudio\/recursivesi\/flint#default/);
  assert.equal(await readFile(join(f.project,'unrelated.txt'),'utf8'),'preserve me');
});
test('independent failing check turns a claimed clean result into repair work',async t=>{
  const f=await fixture({broken:true});t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter(async a=>{
    if(a.role==='fixer') {
      assert.deepEqual(priorIds(a),['evidence:required-check-test-failed-node-test-greet-test-mjs']);
      await writeFile(join(f.project,'greet.mjs'),'export function greet(name) { return `Hello, ${name}!`; }\n');
      return {status:'completed',text:JSON.stringify(fixer(a)),messageId:'fix'};
    }
    return {status:'completed',text:JSON.stringify(verifier(a,{priorFindingResolutions:resolveAll(a)})),messageId:`verify-${a.round}`};
  });
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir,checks:[{id:'test',command:['node','--test','greet.test.mjs']}]}),adapter,undefined,{lockRoot:f.lockRoot,pollMs:1});
  assert.equal(s.phase,'clean',s.reason ?? '');
  assert.deepEqual(adapter.seen.map(a=>a.role),['verifier','fixer','verifier']);
  const first=JSON.parse(await readFile(join(s.runDir,'rounds/001/verifier.json'),'utf8'));
  assert.equal(first.report.outcome,'findings');
});
test('verifier source mutation invalidates the outcome',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const a=new FakeAdapter(async task=>{await writeFile(join(f.project,'greet.mjs'),'unexpected edit');return {status:'completed',text:JSON.stringify(verifier(task)),messageId:'final'};});
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),a,undefined,{lockRoot:f.lockRoot});
  assert.equal(s.phase,'blocked');assert.match(s.reason!,/changed during verification/);
});
test('permission wait reserves checkout; resume reconciles the same worker without another prompt',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  let waiting=true;
  const adapter=new FakeAdapter(a=>waiting?{status:'awaiting_input',requests:[{id:'permission-1'}]}:{status:'completed',text:JSON.stringify(verifier(a)),messageId:'done'});
  const config=fixtureConfig({stateDir:f.stateDir});
  const options={lockRoot:f.lockRoot,pollMs:1};
  const s=await createRun(f.project,config,adapter,undefined,options);
  assert.equal(s.phase,'awaiting_input');assert(s.pending);
  await assert.rejects(createRun(f.project,config,adapter,undefined,options),/Checkout reserved/);
  waiting=false;
  const resumed=await resumeRun(new RunStore(await loadRun(s.runDir,f.project),f.lockRoot),adapter,options);
  assert.equal(resumed.phase,'clean');assert.equal(adapter.submissions,1);assert.equal(adapter.creations,1);
});
test('lost admission response recovers known input without resubmitting',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  class LostResponse extends FakeAdapter {
    lose=true;
    override async ensurePrompt(a:Parameters<FakeAdapter['ensurePrompt']>[0],allow=true) {
      await super.ensurePrompt(a,allow);
      if(this.lose) {this.lose=false;throw new Error('Lost response after admission');}
    }
  }
  const adapter=new LostResponse();
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot,pollMs:1});
  assert.equal(s.phase,'failed');assert.equal(s.pending?.stage,'admitting');
  const done=await resumeRun(new RunStore(await loadRun(s.runDir,f.project),f.lockRoot),adapter,{lockRoot:f.lockRoot,pollMs:1});
  assert.equal(done.phase,'clean');assert.equal(adapter.submissions,1);
});
test('unknown admission never re-prompts and retains its reservation',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  class UnknownResponse extends FakeAdapter {
    override async ensurePrompt() {throw new Error('Unknown admission');}
  }
  const adapter=new UnknownResponse();
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  const resumed=await resumeRun(new RunStore(await loadRun(s.runDir,f.project),f.lockRoot),adapter,{lockRoot:f.lockRoot});
  assert.equal(resumed.phase,'failed');assert.equal(adapter.submissions,0);assert(resumed.pending);
  await assert.rejects(stopRun(new RunStore(resumed,f.lockRoot),adapter),/Unknown admission/);
});
test('changed procedure during a saved wait blocks recovery',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter(()=>({status:'awaiting_input',requests:[{id:'question'}]}));
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  await writeFile(join(f.project,'.opencode/skills/openspec-verify-change/SKILL.md'),'changed procedure');
  const resumed=await resumeRun(new RunStore(await loadRun(s.runDir,f.project),f.lockRoot),adapter,{lockRoot:f.lockRoot});
  assert.equal(resumed.phase,'blocked');assert.match(resumed.reason!,/Pinned/);assert.equal(adapter.submissions,1);
});
test('round limit is unsuccessful even when the fixer reports completion',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter(a=>({status:'completed',text:JSON.stringify(a.role==='fixer'?fixer(a):verifier(a,{outcome:'findings',findings})),messageId:'result'}));
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir,maxRounds:1}),adapter,undefined,{lockRoot:f.lockRoot});
  assert.equal(s.phase,'limited');assert.equal(adapter.submissions,2);
});
test('two unchanged fix cycles stop and preserve reports',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter(a=>({status:'completed',text:JSON.stringify(a.role==='fixer'?fixer(a):verifier(a,{outcome:'findings',findings,
    priorFindingResolutions:a.round>1?findings.map(f=>({findingId:f.id,status:'unresolved',evidence:[],reason:'Still present'})):[]})),messageId:'result'}));
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  assert.equal(s.phase,'blocked');assert.match(s.reason!,/no demonstrable progress/);assert.equal(adapter.submissions,4);
});
test('ambiguous and absent changes never dispatch a worker',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  await command(['openspec','new','change','another-change'],f.project);
  await assert.rejects(selectTarget(f.project),e=>(e as {outcome:string}).outcome==='selection_required');
  await rm(join(f.project,'openspec/changes/add-greeting'),{recursive:true});
  await rm(join(f.project,'openspec/changes/another-change'),{recursive:true});
  await assert.rejects(selectTarget(f.project),e=>(e as {outcome:string}).outcome==='no_active_change');
});
test('a full subsequent verifier can discover a new regression and trigger another fresh fixer',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter(async a=>{
    if(a.role==='fixer') {
      await writeFile(join(f.project,'greet.mjs'),(await readFile(join(f.project,'greet.mjs'),'utf8'))+`// Repair round ${a.round}\n`);
      return {status:'completed',text:JSON.stringify(fixer(a)),messageId:`fix-${a.round}`};
    }
    const previous=a.round>1?[{findingId:`F${a.round-1}`,status:'resolved' as const,evidence:['Updated implementation and test evidence'],reason:''}]:[];
    const report=verifier(a,{outcome:a.round===3?'clean':'findings',findings:a.round===3?[]:[findings[a.round-1]!],priorFindingResolutions:previous});
    return {status:'completed',text:JSON.stringify(report),messageId:`verify-${a.round}`};
  });
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  assert.equal(s.phase,'clean',s.reason??'');assert.equal(adapter.creations,5);
  assert.deepEqual(adapter.seen.map(a=>a.role),['verifier','fixer','verifier','fixer','verifier']);
});
test('an out-of-scope worker commit invalidates verification instead of being accepted',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter(async a=>{
    if(a.role==='fixer') {
      await command(['git','add','--all'],f.project);
      assert.equal((await command(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Unauthorized worker commit'],f.project)).exitCode,0);
      return {status:'completed',text:JSON.stringify(fixer(a)),messageId:'fix'};
    }
    return {status:'completed',text:JSON.stringify(verifier(a,{outcome:'findings',findings})),messageId:'verify'};
  });
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  assert.equal(s.phase,'blocked');assert.match(s.reason!,/HEAD changed/);assert.equal(adapter.submissions,2);
});
