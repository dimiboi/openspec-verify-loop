import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRun, executeLoop, prepareRun, resumeRun, stopRun } from '../src/controller.js';
import { RunManager, runSummary } from '../src/manager.js';
import type { Assignment } from '../src/opencode.js';
import { atomicWrite, loadRun, runDirectory, RunStore } from '../src/state.js';
import { digest, exists } from '../src/util.js';
import { fixture, fixtureConfig, FakeAdapter, findings, verifier } from './fixtures.js';

const saved = (value: unknown) => JSON.parse(JSON.stringify(value));
async function assertConsistent(state: Awaited<ReturnType<typeof createRun>>) {
  const final = JSON.parse(await readFile(join(state.runDir, 'final.json'), 'utf8'));
  assert.deepEqual(final, saved(runSummary(state)));
  return final;
}
const withFindings = (assignment: Assignment) => ({status:'completed' as const,
  text:JSON.stringify(verifier(assignment,{outcome:'findings',findings})),messageId:'verified'});

test('prepared verifier creation failure counts no completed verification and retains its failure context', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const adapter = new FakeAdapter();
  adapter.ensureSession = async () => {throw new Error('create rejected');};
  const state = await createRun(f.project,fixtureConfig({stateDir:join(f.stateDir,'reports (manual)')}),adapter,undefined,{lockRoot:f.lockRoot});
  const result = await assertConsistent(state);
  assert.equal(result.outcome,'failed');
  assert.deepEqual(result.progress.verifier,{prepared:1,submitted:0,completed:0,accepted:0});
  assert.equal(result.rounds,0);
  assert.equal(result.failure.role,'verifier'); assert.equal(result.failure.round,1);
  assert.equal(result.failure.stage,'creating_session'); assert.equal(result.failure.error,'create rejected');
  assert.equal(result.pending,undefined); assert.equal(adapter.submissions,0); assert.equal(adapter.interrupts,1);
});

for (const failure of ['creation','admission'] as const) {
  test(`accepted findings survive fixer ${failure} failure with accurate progress and reservation`, async t => {
    const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
    class FailingFixer extends FakeAdapter {
      override async ensureSession(a: Assignment) {
        if(a.role === 'fixer' && failure === 'creation') throw new Error('fixer create rejected');
        await super.ensureSession(a);
      }
      override async ensurePrompt(a: Assignment, allow = true) {
        if(a.role === 'fixer' && failure === 'admission') throw new Error('fixer response lost');
        await super.ensurePrompt(a,allow);
      }
    }
    const adapter = new FailingFixer(withFindings);
    const store = await prepareRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
    const state = await executeLoop(store,adapter);
    const result = await assertConsistent(state);
    assert.deepEqual(result.progress.verifier,{prepared:1,submitted:1,completed:1,accepted:1});
    assert.deepEqual(result.progress.fixer,{prepared:1,submitted:0,completed:0,accepted:0});
    assert.equal(result.rounds,1); assert.deepEqual(result.unresolvedFindings,findings);
    assert.deepEqual(result.unresolvedSeverityCounts,{critical:1,warning:1,suggestion:1});
    assert.equal(result.failure.role,'fixer'); assert.equal(result.failure.round,1);
    assert.equal(result.failure.stage,failure === 'creation' ? 'creating_session' : 'admitting_prompt');
    assert.equal(result.failure.error,failure === 'creation' ? 'fixer create rejected' : 'fixer response lost');
    assert.equal(await exists(store.lockDir),failure === 'admission');
    assert.equal(Boolean(result.pending),failure === 'admission');
    assert.equal(adapter.submissions,1);
    if(failure === 'admission') assert.equal(result.pending.stage,'admitting');
    const markdown = await readFile(join(state.runDir,'final.md'),'utf8');
    assert.match(markdown,/F2 \(warning\)/); assert.match(markdown,/0 reports accepted/);
    assert.match(markdown,/verifier\.md/); assert.match(markdown,/verifier\.raw\.json/);
  });
}

test('blocked verifier findings are accepted and remain visible in every summary', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const adapter = new FakeAdapter(a => ({status:'completed',messageId:'blocked',text:JSON.stringify(verifier(a,{
    outcome:'blocked',findings,blockers:['Required service unavailable'],
  }))}));
  const state = await createRun(f.project,fixtureConfig({stateDir:join(f.stateDir,'reports (manual)')}),adapter,undefined,{lockRoot:f.lockRoot});
  const result = await assertConsistent(state);
  assert.equal(result.outcome,'blocked'); assert.deepEqual(result.unresolvedFindings,findings);
  assert.equal(result.progress.verifier.accepted,1); assert.equal(result.lastVerifier.outcome,'blocked');
  assert.equal(result.progress.fixer.prepared,0);
  const markdown = await readFile(join(state.runDir,'final.md'),'utf8');
  assert(markdown.includes(`[Report](<${result.lastVerifier.markdown}>)`));
  assert(markdown.includes(`[Raw output](<${result.lastCompletedVerifier.raw}>)`));
});

test('cancellation after accepted verification preserves findings without implying a fixer ran', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const abort = new AbortController(), adapter = new FakeAdapter(withFindings);
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{
    lockRoot:f.lockRoot,signal:abort.signal,emit:event => {
      if((event as {event?:string}).event === 'findings') abort.abort();
    },
  });
  const result = await assertConsistent(state);
  assert.equal(result.outcome,'interrupted'); assert.equal(result.progress.verifier.accepted,1);
  assert.equal(result.progress.fixer.prepared,0); assert.deepEqual(result.unresolvedFindings,findings);
  assert.equal(result.failure.role,'fixer'); assert.equal(result.failure.stage,'before_dispatch');
  assert.equal(adapter.interrupts,0); assert.equal(result.pending,undefined);
});

test('midrun variant disappearance fails at the next pin check and preserves the accepted verifier', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const adapter = new FakeAdapter(withFindings), catalog = await adapter.catalog(f.project);
  let missing = false;
  adapter.catalog = async () => ({...catalog,models:catalog.models.map(model => ({...model,variants:missing ? [] : ['medium']}))});
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir,verifierModel:'fake/test#medium',fixerModel:'fake/test#medium'}),adapter,undefined,{
    lockRoot:f.lockRoot,emit:event => {if((event as {event?:string}).event === 'findings') missing = true;},
  });
  const result = await assertConsistent(state);
  // Pins were checked right after the verifier, so the change surfaces at the fixer's post-worker check.
  assert.equal(result.outcome,'blocked'); assert.equal(result.progress.verifier.accepted,1);
  assert.deepEqual(result.progress.fixer,{prepared:1,submitted:1,completed:1,accepted:0}); assert.deepEqual(result.unresolvedFindings,findings);
  assert.equal(result.failure.role,'fixer'); assert.equal(result.failure.stage,'checking_worker_pins');
  assert.match(result.failure.error,/Unavailable verifier model fake\/test#medium/);
  assert.equal(result.pending,undefined); assert.equal(adapter.submissions,2);
});

test('post-worker pin failure keeps raw completion separate from report acceptance', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const adapter = new FakeAdapter(a => {missing = true; return withFindings(a);});
  const catalog = await adapter.catalog(f.project);
  let missing = false;
  adapter.catalog = async () => ({...catalog,models:catalog.models.map(model => ({...model,variants:missing ? [] : ['medium']}))});
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir,verifierModel:'fake/test#medium',fixerModel:'fake/test#medium'}),adapter,undefined,{lockRoot:f.lockRoot});
  const result = await assertConsistent(state);
  assert.equal(result.outcome,'blocked');
  assert.deepEqual(result.progress.verifier,{prepared:1,submitted:1,completed:1,accepted:0});
  assert.equal(result.rounds,0); assert.equal(result.lastVerifier,undefined);
  assert.equal(result.failure.stage,'checking_worker_pins');
  assert.equal(result.pending,undefined); assert.equal(adapter.interrupts,1);
  assert(await exists(result.lastCompletedVerifier.raw));
  assert.equal(await exists(join(state.runDir,'rounds/001/verifier.json')),false);
});

test('legacy prepared workers never imply completed rounds', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const store = await prepareRun(f.project,fixtureConfig({stateDir:f.stateDir}),new FakeAdapter(),undefined,{lockRoot:f.lockRoot});
  try {
    store.state.workers.push({role:'verifier',round:1,sessionId:'legacy',inputId:'legacy'});
    const result = runSummary(store.state);
    assert.equal(result.rounds,0); assert.equal(result.progress.verifier.prepared,1);
    assert.equal(result.progress.verifier.completed,0); assert.equal(result.progressIncomplete,true);
  } finally {await store.release(false);}
});

for (const legacy of [false,true]) {
  test(`stop preserves proven submission after ${legacy ? 'legacy submitted state' : 'a lost admission response'}`, async t => {
    const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
    class LostResponse extends FakeAdapter {
      lose = !legacy;
      override async ensurePrompt(a: Assignment, allow = true) {
        await super.ensurePrompt(a,allow);
        if (this.lose) {this.lose = false; throw new Error('Lost admitted response');}
      }
    }
    const adapter = new LostResponse(() => ({status:'awaiting_input',requests:[{id:'permission'}]}));
    const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
    const loaded = await loadRun(state.runDir,f.project);
    if (legacy) {
      delete loaded.workers[0]!.progress;
      await atomicWrite(join(loaded.runDir,'state.json'),loaded);
    }
    assert.equal(loaded.pending?.stage,legacy ? 'submitted' : 'admitting');
    const store = new RunStore(loaded,f.lockRoot);
    const stopped = await stopRun(store,adapter);
    const result = await assertConsistent(stopped);
    assert.equal(result.outcome,'interrupted'); assert.equal(result.pending,undefined);
    assert.equal(result.progress.verifier.prepared,1); assert.equal(result.progress.verifier.submitted,1);
    assert.equal(result.progress.verifier.completed,0); assert.equal(result.progress.verifier.accepted,0);
    assert.equal(adapter.submissions,1); assert.equal(adapter.interrupts,1);
    assert.equal(await exists(store.lockDir),false);
  });
}

test('final Markdown persistence failure releases idle ownership and rewrites the failed JSON outcome', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const config = fixtureConfig({stateDir:f.stateDir});
  const notices: unknown[] = [];
  const manager = new RunManager({lockRoot:f.lockRoot,notify:async state => {notices.push(saved(runSummary(state)));}});
  t.after(() => manager.close());
  const adapter = new FakeAdapter(async a => {
    await mkdir(join(runDirectory(f.stateDir,f.project,a.runId),'final.md'));
    return {status:'completed',text:JSON.stringify(verifier(a)),messageId:'complete'};
  });
  const run = await manager.start(f.project,config,adapter);
  await manager.wait(f.project);
  const state = await loadRun(run.runDir,f.project);
  const result = await assertConsistent(state);
  assert.equal(result.outcome,'failed'); assert.equal(result.finalizationFailure.stage,'persisting_outcome');
  assert.deepEqual(notices,[result]);
  assert.equal(result.progress.verifier.accepted,1); assert.equal(adapter.submissions,1);
  assert.equal(await exists(new RunStore(state,f.lockRoot).lockDir),false);
  // The same host can start another run after the failed report write.
  const next = await manager.start(f.project,config,new FakeAdapter());
  await manager.wait(f.project);
  assert.equal((await manager.status(f.project,config,next.runId) as any).outcome,'clean');
});

for (const removedExecutor of [false,true]) {
test(`ownership release failure preserves the lease and aligns summaries${removedExecutor ? ' after executor removal' : ''}`, async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const originalRelease = RunStore.prototype.release;
  t.mock.method(RunStore.prototype,'release',async function(this: RunStore,retain: boolean) {
    if(this.state.project === f.project) {
      if (removedExecutor) delete this.state.executor;
      throw new Error('Injected release failure');
    }
    return originalRelease.call(this,retain);
  });
  const config = fixtureConfig({stateDir:f.stateDir}), notices: unknown[] = [];
  const manager = new RunManager({lockRoot:f.lockRoot,notify:async state => {notices.push(saved(runSummary(state)));}});
  t.after(() => manager.close());
  const adapter = new FakeAdapter();
  const run = await manager.start(f.project,config,adapter);
  await manager.wait(f.project);
  const state = await loadRun(run.runDir,f.project);
  const result = await assertConsistent(state);
  assert.equal(result.outcome,'failed'); assert.equal(result.failure.error,'Injected release failure');
  assert.equal(result.finalizationFailure.stage,'releasing_ownership');
  assert.deepEqual(result.executor,{pid:process.pid,runtimeId:manager.runtimeId});
  assert.deepEqual(notices,[result]); assert.equal(adapter.submissions,1);
  assert.equal(await exists(new RunStore(state,f.lockRoot).lockDir),true);
  await assert.rejects(manager.start(f.project,config,new FakeAdapter()),/Checkout reserved/);
  assert.match(await readFile(join(run.runDir,'final.md'),'utf8'),/Injected release failure/);
});
}

for (const throwAfterHandoff of [false,true]) {
test(`outcome persistence failure cannot overwrite a successor after handoff${throwAfterHandoff ? ' even when release throws afterward' : ''}`, async t => {
  const f = await fixture();
  const originalRelease = RunStore.prototype.release;
  let successor: RunStore | undefined, successorSnapshot: unknown, handedOff = false;
  t.mock.method(RunStore.prototype,'release',async function(this: RunStore,retain: boolean) {
    await originalRelease.call(this,retain);
    if (this.state.project !== f.project || !retain || handedOff) return;
    handedOff = true;
    successor = new RunStore(await loadRun(this.state.runDir,f.project),f.lockRoot,'successor-runtime');
    await successor.acquire(true);
    successor.state.phase = 'verifying';
    successor.state.reason = 'Successor owns the saved state';
    successor.state.requests = [{id:'successor-request'}];
    await successor.save();
    successorSnapshot = saved(successor.state);
    if (throwAfterHandoff) throw new Error('Release returned after relinquishing ownership');
  });
  const manager = new RunManager({lockRoot:f.lockRoot});
  t.after(async () => {
    try {
      await manager.close();
      if (successor) await originalRelease.call(successor,true);
    } finally {await rm(f.base,{recursive:true,force:true});}
  });
  const adapter = new FakeAdapter(async a => {
    await mkdir(join(runDirectory(f.stateDir,f.project,a.runId),'final.md'));
    return {status:'awaiting_input',requests:[{id:'permission'}]};
  });
  const run = await manager.start(f.project,fixtureConfig({stateDir:f.stateDir}),adapter);
  await manager.wait(f.project);
  assert(handedOff); assert(successor);
  const state = await loadRun(run.runDir,f.project);
  assert.deepEqual(saved(state),successorSnapshot);
  assert.deepEqual(state.executor,{pid:process.pid,runtimeId:'successor-runtime'});
  assert.equal(state.pending?.assignment.sessionId,adapter.seen[0]!.sessionId);
  assert.equal(state.pending?.assignment.inputId,adapter.seen[0]!.inputId);
  assert.equal(adapter.submissions,1); assert.equal(adapter.interrupts,0);
  assert.equal(await successor.hasLiveOwnership(),true);
  const final = JSON.parse(await readFile(join(run.runDir,'final.json'),'utf8'));
  assert.equal(final.outcome,'failed'); assert.equal(final.finalizationFailure.stage,'persisting_outcome');
});
}

test('a post-release result callback cannot change a saved outcome', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),new FakeAdapter(),undefined,{
    lockRoot:f.lockRoot,emit:event => {
      if ('outcome' in (event as object)) throw new Error('Consumer callback failed');
    },
  });
  assert.equal(state.phase,'clean'); await assertConsistent(state);
});

test('a transient failure-save error remains failed before releasing its pending worker reservation', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const originalSave = RunStore.prototype.save;
  let injected = false;
  t.mock.method(RunStore.prototype,'save',async function(this: RunStore) {
    if (this.state.project === f.project && !injected && this.state.failure?.error === 'Host worker failed') {
      injected = true;
      throw new Error('Transient failure-state write');
    }
    return originalSave.call(this);
  });
  const notices: unknown[] = [];
  const manager = new RunManager({lockRoot:f.lockRoot,notify:async state => {notices.push(saved(runSummary(state)));}});
  t.after(() => manager.close());
  const adapter = new FakeAdapter(() => ({status:'failed',reason:'Host worker failed'}));
  const config = fixtureConfig({stateDir:f.stateDir});
  const run = await manager.start(f.project,config,adapter);
  await manager.wait(f.project);
  const state = await loadRun(run.runDir,f.project), result = await assertConsistent(state);
  assert(injected); assert.equal(result.outcome,'failed'); assert.deepEqual(notices,[result]);
  assert.equal(result.failure.error,'Host worker failed'); assert.equal(result.failure.stage,'observing_worker');
  assert.equal(result.finalizationFailure.stage,'saving_failure');
  assert.equal(result.finalizationFailure.error,'Transient failure-state write');
  assert.equal(result.pending.stage,'submitted'); assert.equal(adapter.submissions,1); assert.equal(adapter.interrupts,0);
  const owner = JSON.parse(await readFile(join(new RunStore(state,f.lockRoot).lockDir,'owner.json'),'utf8'));
  assert.equal(owner.pid,null);
  await assert.rejects(manager.start(f.project,config,new FakeAdapter()),/Checkout reserved/);
});

test('old paused cleanup cannot replace a successor clean outcome after its reservation was released', async t => {
  const f = await fixture();
  const originalRelease = RunStore.prototype.release;
  let advanced = false, clean = false, successorSnapshot: unknown;
  const adapter = new FakeAdapter(a => clean
    ? {status:'completed',text:JSON.stringify(verifier(a)),messageId:'successor-clean'}
    : {status:'awaiting_input',requests:[{id:'permission'}]});
  t.mock.method(RunStore.prototype,'release',async function(this: RunStore,retain: boolean) {
    await originalRelease.call(this,retain);
    if (this.state.project !== f.project || !retain || advanced) return;
    advanced = true; clean = true;
    const successor = new RunStore(await loadRun(this.state.runDir,f.project),f.lockRoot,'clean-successor');
    await successor.acquire(true);
    await executeLoop(successor,adapter);
    successorSnapshot = saved(await loadRun(this.state.runDir,f.project));
  });
  const manager = new RunManager({lockRoot:f.lockRoot});
  t.after(async () => {try {await manager.close();} finally {await rm(f.base,{recursive:true,force:true});}});
  const run = await manager.start(f.project,fixtureConfig({stateDir:f.stateDir}),adapter);
  await manager.wait(f.project);
  const before = await loadRun(run.runDir,f.project);
  assert.equal(before.phase,'clean'); assert.equal(before.pending,undefined);
  const finalBefore = await readFile(join(run.runDir,'final.json'),'utf8');
  await manager.close();
  assert.deepEqual(saved(await loadRun(run.runDir,f.project)),successorSnapshot);
  assert.equal(await readFile(join(run.runDir,'final.json'),'utf8'),finalBefore);
  assert.equal(await exists(new RunStore(before,f.lockRoot).lockDir),false);
  assert.equal(adapter.submissions,1); assert.equal(adapter.interrupts,0);
});

test('a recovery waiter rechecks ownership under its claim before publishing stale state', async t => {
  const f = await fixture();
  const adapter = new FakeAdapter(() => ({status:'awaiting_input',requests:[{id:'permission'}]}));
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  const stale = new RunStore(await loadRun(state.runDir,f.project),f.lockRoot,'stale-waiter');
  let successor: RunStore | undefined, successorSnapshot: unknown, interleaved = false;
  const prototype = RunStore.prototype as unknown as {readOwner: () => Promise<unknown>};
  const originalRead = prototype.readOwner;
  t.mock.method(prototype,'readOwner',async function(this: RunStore) {
    const owner = await originalRead.call(this);
    if (this === stale && !interleaved) {
      interleaved = true;
      successor = new RunStore(await loadRun(state.runDir,f.project),f.lockRoot,'new-owner');
      await successor.acquire(true);
      successor.state.reason = 'Fresh owner must survive stale recovery';
      await successor.save();
      successorSnapshot = saved(successor.state);
    }
    return owner;
  });
  t.after(async () => {
    try {if (successor) await successor.release(true);}
    finally {await rm(f.base,{recursive:true,force:true});}
  });
  await assert.rejects(stale.acquire(true),/reservation changed during recovery/);
  assert(interleaved); assert(successor);
  assert.deepEqual(saved(await loadRun(state.runDir,f.project)),successorSnapshot);
  assert.deepEqual((await readdir(stale.lockDir)).filter(name => name.startsWith('recovery-')),[]);
  assert.equal(await stale.hasLiveOwnership(),false); assert.equal(await successor.hasLiveOwnership(),true);
  assert.equal(adapter.submissions,1); assert.equal(adapter.interrupts,0);
});

for (const action of ['stop','resume'] as const) {
test(`explicit ${action} refreshes a stale snapshot and preserves a successor clean outcome`, async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const adapter = new FakeAdapter(() => ({status:'awaiting_input',requests:[{id:'permission'}]}));
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  const stale = new RunStore(await loadRun(state.runDir,f.project),f.lockRoot,'stale-explicit');
  adapter.handler = a => ({status:'completed',text:JSON.stringify(verifier(a)),messageId:'successor-complete'});
  const successor = await resumeRun(new RunStore(await loadRun(state.runDir,f.project),f.lockRoot),adapter);
  assert.equal(successor.phase,'clean'); assert.equal(stale.state.phase,'awaiting_input');
  const before = await readFile(join(state.runDir,'final.json'),'utf8');
  if (action === 'stop') assert.equal((await stopRun(stale,adapter)).phase,'clean');
  else await assert.rejects(resumeRun(stale,adapter),/already clean/);
  const latest = await loadRun(state.runDir,f.project);
  assert.equal(latest.phase,'clean'); assert.equal(latest.pending,undefined);
  assert.deepEqual(latest.workers,successor.workers); assert.deepEqual(latest.verifier,successor.verifier);
  assert.equal(await readFile(join(state.runDir,'final.json'),'utf8'),before);
  assert.equal(await exists(stale.lockDir),false);
  assert.equal(adapter.submissions,1); assert.equal(adapter.interrupts,0);
});
}

test('explicit recovery refreshes the latest pending dispatch instead of replaying an old worker', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const adapter = new FakeAdapter(() => ({status:'awaiting_input',requests:[{id:'permission'}]}));
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  const stale = new RunStore(await loadRun(state.runDir,f.project),f.lockRoot,'stale-pending');
  const oldInput = stale.state.pending!.assignment.inputId;
  adapter.handler = a => a.role === 'verifier' ? withFindings(a) : {status:'awaiting_input',requests:[{id:'fixer-permission'}]};
  const advanced = await resumeRun(new RunStore(await loadRun(state.runDir,f.project),f.lockRoot),adapter);
  const pending = advanced.pending!.assignment;
  assert.equal(pending.role,'fixer'); assert.notEqual(pending.inputId,oldInput);
  const resumed = await resumeRun(stale,adapter);
  assert.equal(resumed.pending?.assignment.sessionId,pending.sessionId);
  assert.equal(resumed.pending?.assignment.inputId,pending.inputId);
  assert.deepEqual(resumed.verifier,advanced.verifier); assert.equal(resumed.workers.length,2);
  assert.equal(adapter.submissions,2); assert.equal(adapter.creations,2); assert.equal(adapter.interrupts,0);
});

test('rejected recovery cleanup preserves a newer generation recovery claim', async t => {
  const f = await fixture(); t.after(() => rm(f.base,{recursive:true,force:true}));
  const adapter = new FakeAdapter(() => ({status:'awaiting_input',requests:[{id:'permission'}]}));
  const state = await createRun(f.project,fixtureConfig({stateDir:f.stateDir}),adapter,undefined,{lockRoot:f.lockRoot});
  const stale = new RunStore(await loadRun(state.runDir,f.project),f.lockRoot,'stale-generation');
  const nextToken = 'new/reservation-token';
  const nextClaim = join(stale.lockDir,`recovery-${digest(nextToken)}`);
  const prototype = RunStore.prototype as unknown as {readOwner: () => Promise<Record<string,unknown>>};
  const originalRead = prototype.readOwner;
  let interleaved = false, oldClaim: string | undefined;
  t.mock.method(prototype,'readOwner',async function(this: RunStore) {
    const owner = await originalRead.call(this);
    if (this === stale && !interleaved) {
      interleaved = true;
      oldClaim = join(stale.lockDir,`recovery-${digest(String(owner.token))}`);
      await atomicWrite(join(stale.lockDir,'owner.json'),{...owner,token:nextToken,runtimeId:'new-generation'});
      await writeFile(nextClaim,'new-generation-claim',{flag:'wx'});
    } else if (this === stale) {
      assert(oldClaim); assert.equal(await exists(oldClaim),true);
      assert.equal(await exists(nextClaim),true);
    }
    return owner;
  });
  await assert.rejects(stale.acquire(true),/reservation changed during recovery/);
  assert(oldClaim); assert.equal(await exists(oldClaim),false);
  assert.equal(await readFile(nextClaim,'utf8'),'new-generation-claim');
  assert.equal((await loadRun(state.runDir,f.project)).pending?.assignment.inputId,state.pending!.assignment.inputId);
  assert.equal(adapter.submissions,1);
});
