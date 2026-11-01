import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { atomicWrite, ensureExternalState, RunStore, type RunState } from '../src/state.js';
import { createRun, stopRun, resumeRun } from '../src/controller.js';
import { fixtureConfig, fixture, FakeAdapter } from './fixtures.js';

test('atomic writes keep state readable and replace the whole document',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'loop-state-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'state.json');await atomicWrite(path,{phase:'before'});await atomicWrite(path,{phase:'after',count:2});
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{phase:'after',count:2});
  await assert.rejects(ensureExternalState(join(dir,'state'),dir),/outside/);
});
test('unconfirmed cancellation retains exclusive ownership; successful stop releases it',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const adapter=new FakeAdapter(()=>({status:'running'}));adapter.interruptResult=false;
  const abort=new AbortController();
  adapter.handler=()=>{abort.abort();return {status:'running'};};
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot,signal:abort.signal,pollMs:1});
  assert.equal(s.phase,'interrupted');assert(s.pending);
  await assert.rejects(createRun(f.project,s.config,adapter,undefined,{lockRoot:f.lockRoot}),/Checkout reserved/);
  adapter.interruptResult=true;
  await stopRun(new RunStore(s,f.lockRoot),adapter);
  const fresh=new FakeAdapter();
  assert.equal((await createRun(f.project,s.config,fresh,undefined,{lockRoot:f.lockRoot})).phase,'clean');
});
test('two controllers cannot simultaneously resume the same reservation',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const a=new FakeAdapter(()=>({status:'awaiting_input',requests:[{id:'request'}]}));
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),a,undefined,{lockRoot:f.lockRoot});
  const first=new RunStore(s,f.lockRoot);await first.acquire(true);
  assert.equal(JSON.parse(await readFile(join(s.runDir,'state.json'),'utf8')).executor.pid,process.pid);
  const second=new RunStore(structuredClone(s),f.lockRoot);
  await assert.rejects(second.acquire(true),/still running/);
  await first.release(true);
});
test('a changed requirement blocks an existing run; time limits cannot return clean',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const a=new FakeAdapter(()=>({status:'awaiting_input',requests:[{id:'request'}]}));
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),a,undefined,{lockRoot:f.lockRoot});
  await writeFile(join(f.target,'design.md'),'Changed approved design');
  const done=await resumeRun(new RunStore(s,f.lockRoot),a,{lockRoot:f.lockRoot});
  assert.equal(done.phase,'blocked');assert.match(done.reason!,/Pinned/);
  const limited=await createRun(f.project,fixtureConfig({stateDir:f.stateDir,maxMinutes:0.000001}),new FakeAdapter(),undefined,{lockRoot:f.lockRoot});
  assert.equal(limited.phase,'limited');
});
test('a crash after saving clean can release its reservation without losing the clean outcome',async t=>{
  const f=await fixture();t.after(()=>rm(f.base,{recursive:true,force:true}));
  const s=await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),new FakeAdapter(),undefined,{lockRoot:f.lockRoot});
  const abandoned=new RunStore(s,f.lockRoot);await abandoned.acquire(true);await abandoned.release(true);
  await rm(join(s.runDir,'final.json'));
  const recovered=await stopRun(new RunStore(s,f.lockRoot));
  assert.equal(recovered.phase,'clean');
  assert.equal(JSON.parse(await readFile(join(s.runDir,'final.json'),'utf8')).outcome,'clean');
  assert.equal((await createRun(f.project,s.config,new FakeAdapter(),undefined,{lockRoot:f.lockRoot})).phase,'clean');
});
