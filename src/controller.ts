import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm } from 'node:fs/promises';
import type { Adapter, Assignment, Model } from './opencode.js';
import { checkPins, evidenceFailures, gatherEvidence, pinTarget, selectTarget, type Evidence } from './openspec.js';
import type { Config } from './config.js';
import { needsRepair, parseReport, type Finding } from './reports.js';
import { atomicWrite, defaultStateRoot, ensureExternalState, newId, RunStore, runDirectory, type ReservationIdentity, type RunState } from './state.js';
import { changedFiles, delay, digest, errorMessage, LoopError, snapshot, VERSION } from './util.js';
import { workerPrompt } from './prompts.js';
import { runSummary, summaryMarkdown } from './summary.js';

export type LoopOptions = {signal?: AbortSignal; pollMs?: number; emit?: (event: unknown) => void; lockRoot?: string; originModel?: Model; originSessionId?: string; runtimeId?: string};
async function persistEvidence(s: RunState, round: number, evidence?: Evidence) {
  if(evidence)await atomicWrite(join(s.runDir,'rounds',String(round).padStart(3,'0'),'checks.json'),{
    workspace:evidence.after.hash,validation:evidence.validation,apply:evidence.apply,checks:evidence.checks,
  });
}
export async function persistOutcome(s: RunState, includeExecutor = false) {
  // Release removes executor ownership after the final files are written. It is
  // transient process metadata, not part of the durable outcome being reported.
  const final = {...runSummary(s), executor: includeExecutor ? s.executor : undefined};
  await atomicWrite(join(s.runDir,'final.json'),final);
  await atomicWrite(join(s.runDir,'final.md'),summaryMarkdown(s),true);
  return final;
}
export async function prepareRun(project: string, config: Config, adapter: Adapter, change?: string, options: LoopOptions = {}) {
  const target = await selectTarget(project, change);
  const pins = await pinTarget(target, config, adapter, {originModel: options.originModel});
  const root = await ensureExternalState(config.stateDir ?? defaultStateRoot(), project, resolve(dirname(fileURLToPath(import.meta.url)),'..'));
  const runId = newId('run');
  const runDir = runDirectory(root, project, runId);
  const initial = await snapshot(project);
  const state: RunState = {schemaVersion:2,pluginVersion:VERSION,originSessionId:options.originSessionId,runId,runDir,project,config,pins,initial,
    phase:'preflight',nextRole:'verifier',round:1,createdAt:Date.now(),updatedAt:Date.now(),activeMs:0,
    prior:[],stalledCycles:0,workers:[]};
  const store = new RunStore(state, options.lockRoot, options.runtimeId);
  await store.acquire();
  try { await store.save(); } catch (e) { await store.release(false); throw e; }
  return store;
}
export async function createRun(project: string, config: Config, adapter: Adapter, change?: string, options: LoopOptions = {}) {
  return executeLoop(await prepareRun(project, config, adapter, change, options), adapter, options);
}
function findingsFingerprint(findings: Finding[]) {
  // IDs and wording are model-owned; categories, affected locations, and severities are a stable comparison aid.
  return digest(JSON.stringify(findings.map(f => ({severity:f.severity,category:f.category.toLowerCase(),locations:[...f.locations].sort()}))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
}
export async function executeLoop(store: RunStore, adapter: Adapter, options: LoopOptions = {}): Promise<RunState> {
  const s = store.state;
  const started = Date.now();
  const remaining = s.config.maxMinutes ? Math.max(1, s.createdAt + s.config.maxMinutes*60_000 - started) : undefined;
  const timer = remaining !== undefined && remaining < 2_147_483_647 ? AbortSignal.timeout(Math.ceil(remaining)) : undefined;
  const workSignal = options.signal && timer ? AbortSignal.any([options.signal,timer]) : options.signal ?? timer;
  const previousActive = s.activeMs;
  let activity = {role: s.pending?.assignment.role ?? s.nextRole, round: s.pending?.assignment.round ?? s.round, stage: 'checking_pins'};
  const at = (stage: string, role = s.pending?.assignment.role ?? s.nextRole, round = s.pending?.assignment.round ?? s.round) => {
    activity = {role, round, stage};
  };
  const emit = (event: unknown) => options.emit?.(event);
  const save = async () => { s.activeMs = previousActive + Date.now() - started; await store.save(); };
  const terminate = async (outcome: RunState['phase'], reason: string, preservePending = false) => {
    if (preservePending && s.pending?.stage === 'admitting') reason += '; prompt admission is uncertain; checkout remains reserved';
    if (s.pending && !preservePending) {
      const confirmed = await adapter.interrupt(s.pending.assignment).catch(() => false);
      if (confirmed) {
        // Interrupted verification/fix never certifies the current workspace. Resume starts a fresh verifier.
        if (s.pending.assignment.role === 'verifier') s.round++;
        delete s.pending;
        s.nextRole = 'verifier';
      } else reason += '; worker termination is unconfirmed; checkout remains reserved';
    }
    s.phase = outcome; s.reason = reason; await save();
  };
  const guard = async () => {
    if (options.signal?.aborted || await store.stopping()) throw new LoopError('interrupted', 'Stopped by user');
    if (s.config.maxMinutes && Date.now() - s.createdAt >= s.config.maxMinutes * 60_000) throw new LoopError('limited', 'Time limit reached');
  };
  try {
    await rm(join(s.runDir, 'final.json'), {force:true});
    await rm(join(s.runDir, 'final.md'), {force:true});
    delete s.reason; delete s.failure; delete s.finalizationFailure; delete s.requests;
    emit({event:'started',runId:s.runId,runDir:s.runDir,change:s.pins.changeName,models:s.pins.models});
    await checkPins(s.pins, s.config, adapter);
    while (true) {
      at('before_dispatch');
      await guard();
      if (!s.pending) {
        if (s.config.maxRounds && s.round > s.config.maxRounds) throw new LoopError('limited', 'Verification round limit reached');
        at('checking_pins');
        await checkPins(s.pins, s.config, adapter);
        const role = s.nextRole;
        at('gathering_evidence');
        const evidence = role === 'verifier' ? await gatherEvidence(s.pins, s.config, workSignal) : undefined;
        if(evidence)s.taskContext=evidence.apply;
        at('snapshotting');
        const before = evidence?.after ?? await snapshot(s.project);
        at('building_prompt');
        const prompt = await workerPrompt(s, role, evidence);
        at('persisting_evidence');
        await persistEvidence(s,s.round,evidence);
        if (Buffer.byteLength(prompt) > 2 * 1024 * 1024) throw new LoopError('blocked', 'Complete worker context exceeds 2 MiB; reduce report/context size without dropping findings');
        const assignment: Assignment = {sessionId:newId('ses'),inputId:newId('msg'),project:s.project,runId:s.runId,
          role,round:s.round,agent:s.pins.agents[role],model:s.pins.models[role],permissions:s.pins.permissions[role],prompt};
        s.pending = {assignment,stage:'prepared',before,...(evidence ? {evidence} : {})};
        s.phase = role === 'verifier' ? 'verifying' : 'fixing';
        s.workers.push({sessionId:assignment.sessionId,inputId:assignment.inputId,role,round:s.round,progress:'prepared'});
        await save(); // Write-ahead identity and complete prompt precede all network mutation.
        await store.event('dispatch_prepared', {sessionId:assignment.sessionId,role,round:s.round});
      }
      const pending = s.pending;
      const a = pending.assignment;
      const worker = s.workers.find(worker => worker.sessionId === a.sessionId && worker.inputId === a.inputId);
      s.phase = a.role === 'verifier' ? 'verifying' : 'fixing';
      if (pending.stage === 'prepared') {
        at('creating_session');
        await adapter.ensureSession(a);
        pending.stage = 'created'; await save();
      }
      if (pending.stage === 'created') {
        pending.stage = 'admitting'; await save();
        at('admitting_prompt');
        await adapter.ensurePrompt(a, true);
        pending.stage = 'submitted'; if (worker) worker.progress = 'submitted'; await save();
      } else if (pending.stage === 'admitting') {
        at('reconciling_prompt');
        await adapter.ensurePrompt(a, false);
        pending.stage = 'submitted'; if (worker) worker.progress = 'submitted'; await save();
      }
      emit({event:'worker',role:a.role,round:a.round,sessionId:a.sessionId,inputId:a.inputId});
      const progress = new AbortController();
      const subscription = adapter.subscribe?.(a.sessionId, progress.signal, type => emit({event:'progress',role:a.role,round:a.round,type}));
      let observation;
      at('observing_worker');
      try {
        let failures = 0;
        while (true) {
          await guard();
          try { observation = await adapter.observe(a); failures = 0; }
          catch (e) {
            if (++failures >= 3) throw new Error(`Cannot reconcile worker after 3 attempts: ${errorMessage(e)}`);
            emit({event:'reconnecting',attempt:failures});
            await delay(options.pollMs ?? 1000, workSignal); continue;
          }
          if (observation.status !== 'running') break;
          await delay(options.pollMs ?? 1000, workSignal);
        }
      } finally { progress.abort(); await subscription; }
      if (observation.status === 'awaiting_input') {
        s.requests = observation.requests;
        await terminate('awaiting_input', 'Worker needs permission or user input; answer in its OpenCode session, then explicitly resume this run', true);
        break;
      }
      if (observation.status !== 'completed') {
        throw new LoopError(observation.status === 'interrupted' ? 'interrupted' : 'failed', observation.reason);
      }
      const roundDir = join(s.runDir, 'rounds', String(a.round).padStart(3, '0'));
      at('saving_output');
      await mkdir(roundDir, {recursive:true});
      await atomicWrite(join(roundDir, `${a.role}.raw.json`), {sessionId:a.sessionId,inputId:a.inputId,messageId:observation.messageId,text:observation.text});
      if (worker) worker.progress = 'completed';
      await save();
      await persistEvidence(s,a.round,pending.evidence);
      if(pending.evidence)s.taskContext=pending.evidence.apply;
      at('checking_worker_pins');
      await checkPins(s.pins, s.config, adapter);
      at('checking_workspace');
      const after = await snapshot(s.project);
      await guard();
      if(after.head!==pending.before.head) throw new LoopError('blocked','Checkout HEAD changed during the worker assignment; committing or switching branches is outside this loop');
      if (a.role === 'verifier' && pending.before.hash !== after.hash) {
        throw new LoopError('blocked', `Checkout changed during verification: ${changedFiles(pending.before, after).join(', ')}; a fresh reviewed run is required`);
      }
      at('validating_report');
      const report = parseReport(observation.text, a.role, {runId:s.runId,round:a.round,changeName:s.pins.changeName,targetPath:s.pins.targetPath}, s.prior);
      if (report.role === 'verifier' && report.outcome === 'clean') {
        at('checking_evidence');
        const failures = pending.evidence ? evidenceFailures(pending.evidence) : ['No independent check evidence'];
        if (failures.length) throw new Error(`Clean report contradicts independent evidence: ${failures.join('; ')}`);
      }
      at('accepting_report');
      await atomicWrite(join(roundDir, `${a.role}.json`), {sessionId:a.sessionId,inputId:a.inputId,messageId:observation.messageId,workspace:after.hash,report});
      await atomicWrite(join(roundDir, `${a.role}.md`), report.fullReportMarkdown, true);
      if (worker) worker.progress = 'accepted';
      delete s.pending;
      if (report.role === 'verifier') {
        s.verifier = report;
        s.prior = needsRepair(report, s.prior);
      } else s.fixer = report;
      await save();
      await store.event('report_accepted', {role:a.role,round:a.round,messageId:observation.messageId});
      if (report.role === 'verifier') {
        if (report.outcome === 'blocked' || report.blockers.length) {
          await terminate('blocked', report.blockers.join('; ')); break;
        }
        if (report.outcome === 'clean') {
          s.phase = 'clean'; s.reason = 'Fresh full verification has zero findings and all applicable checks are verified';
          s.prior = []; await save(); break;
        }
        s.nextRole = 'fixer';
        emit({event:'findings',round:s.round,count:s.prior.length});
      } else {
        if (report.outcome === 'blocked') {
          await terminate('blocked', [...report.blockers,...report.unresolvedFindings.map(f=>f.reason)].join('; ')); break;
        }
        const fingerprint = findingsFingerprint(s.prior);
        const unchanged = pending.before.hash === after.hash;
        // Model-owned wording/categories cannot manufacture progress without a workspace change.
        s.stalledCycles = unchanged ? s.stalledCycles + 1 : 0;
        s.lastFixFingerprint = fingerprint; s.lastFixWorkspace = after.hash;
        s.nextRole = 'verifier'; s.round++;
        if (s.stalledCycles >= 2) { await terminate('blocked', 'Two consecutive fix cycles made no demonstrable progress'); break; }
      }
      await save();
    }
  } catch (e) {
    const phase = options.signal?.aborted ? 'interrupted' : timer?.aborted ? 'limited' : e instanceof LoopError &&
      ['blocked','interrupted','limited'].includes(e.outcome) ? e.outcome as RunState['phase'] : 'failed';
    s.failure = {...activity, error:errorMessage(e), ...(s.pending ? {
      sessionId:s.pending.assignment.sessionId,inputId:s.pending.assignment.inputId,
    } : {})};
    // Failure context must survive interruption and cleanup of its pending worker.
    try {
      await save();
      await terminate(phase, timer?.aborted && !options.signal?.aborted ? 'Time limit reached' : errorMessage(e), s.pending?.stage === 'admitting');
    } catch (error) {
      if (!await store.hasLiveOwnership()) throw error;
      // Finalization below can persist a recovered store. Contain this error
      // before release, retaining the original worker failure and pending lease.
      s.phase = 'failed'; s.reason = errorMessage(error);
      s.finalizationFailure = {...activity,stage:'saving_failure',error:errorMessage(error)};
    }
  } finally {
    let final: Awaited<ReturnType<typeof persistOutcome>> | undefined;
    let outcomeError: unknown;
    try { final = await persistOutcome(s); }
    catch (error) {
      if (!await store.hasLiveOwnership()) throw error;
      outcomeError = error;
      s.finalizationFailure = {...activity,stage:'persisting_outcome',error:errorMessage(error)};
      s.failure ??= s.finalizationFailure;
      s.phase = 'failed'; s.reason = errorMessage(error);
      await save().catch(() => {});
      // Repair any partially written final while this controller still owns the
      // lease. Releasing below is the final durable action for this generation.
      try { final = await persistOutcome(s); }
      catch (error) { await store.event('final_report_failed',{reason:errorMessage(error)}).catch(() => {}); }
    }
    // A report write failure must not strand an idle controller's live PID.
    // Pending workers still retain their checkout reservation through release.
    try { await store.release(Boolean(s.pending)); }
    catch (error) {
      if (await store.hasLiveOwnership()) {
        if (s.finalizationFailure) s.finalizationFailure.cleanupError = errorMessage(error);
        else s.finalizationFailure = {...activity,stage:'releasing_ownership',error:errorMessage(error)};
      }
      throw outcomeError ?? error;
    }
    // A consumer callback runs after handoff and cannot reopen a fatal writer.
    if (final) { try { emit(final); } catch {} }
  }
  return s;
}

export async function prepareResume(store: RunStore, adapter: Adapter, options: LoopOptions = {}) {
  await store.acquire(true);
  if (store.state.phase === 'clean') {
    // A crash after persisting clean but before releasing its reservation must remain recoverable.
    try {await persistOutcome(store.state);} finally {await store.release(false);}
    throw new LoopError('blocked', 'This run is already clean; its reservation is released. Start a new run to verify again');
  }
  await rm(join(store.state.runDir,'stop.request'), {force:true});
  if (!store.state.pending) {
    store.state.round = Math.max(store.state.round, ...store.state.workers.map(w=>w.round + 1));
    store.state.nextRole = 'verifier';
    store.state.stalledCycles = 0;
  }
  return store;
}
export async function resumeRun(store: RunStore, adapter: Adapter, options: LoopOptions = {}) {
  return executeLoop(await prepareResume(store, adapter, options), adapter, options);
}

/** An inactive run is recovered under the same checkout lease before cancellation. */
export async function stopRun(store: RunStore, adapter?: Adapter, expected?: ReservationIdentity) {
  if (!await store.acquire(true,expected)) return store.state;
  try {
    if(store.state.phase==='clean' && !store.state.pending) {
      await persistOutcome(store.state);
      return store.state;
    }
    if (store.state.pending?.stage === 'admitting') {
      // Absence after a lost HTTP response does not prove that the server cannot still admit it.
      // Retain the reservation until the original input becomes observable; never race a late fixer.
      if(!adapter)throw new Error('Worker reconciliation requires the OpenCode adapter');
      await adapter.ensurePrompt(store.state.pending.assignment, false);
      store.state.pending.stage = 'submitted';
    }
    if (store.state.pending?.stage === 'submitted') {
      // Reconciliation proves submission even when the original response was
      // lost. Preserve that fact before cancellation removes the pending input.
      const worker = store.state.workers.find(worker => worker.sessionId === store.state.pending!.assignment.sessionId &&
        worker.inputId === store.state.pending!.assignment.inputId);
      if (worker && (!worker.progress || worker.progress === 'prepared')) worker.progress = 'submitted';
      await store.save();
    }
    if (store.state.pending && (!adapter || !await adapter.interrupt(store.state.pending.assignment))) {
      throw new LoopError('blocked', 'Worker termination is unconfirmed; checkout remains reserved');
    }
    delete store.state.pending;
    delete store.state.requests;
    store.state.nextRole = 'verifier';
    store.state.phase = 'interrupted'; store.state.reason = 'Stopped by user';
    await store.save();
    await persistOutcome(store.state);
  } finally { await store.release(Boolean(store.state.pending)); }
  return store.state;
}
