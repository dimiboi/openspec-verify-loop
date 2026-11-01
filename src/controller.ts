import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm } from 'node:fs/promises';
import type { Adapter, Assignment } from './opencode.js';
import { checkPins, evidenceFailures, gatherEvidence, pinTarget, selectTarget, type Evidence } from './openspec.js';
import type { Config } from './config.js';
import { needsRepair, parseReport, type Finding } from './reports.js';
import { atomicWrite, defaultStateRoot, ensureExternalState, newId, RunStore, runDirectory, type RunState } from './state.js';
import { changedFiles, delay, digest, errorMessage, LoopError, snapshot, VERSION } from './util.js';
import { workerPrompt } from './prompts.js';

export type LoopOptions = {signal?: AbortSignal; pollMs?: number; emit?: (event: unknown) => void; lockRoot?: string};
async function persistEvidence(s: RunState, round: number, evidence?: Evidence) {
  if(evidence)await atomicWrite(join(s.runDir,'rounds',String(round).padStart(3,'0'),'checks.json'),{
    workspace:evidence.after.hash,validation:evidence.validation,apply:evidence.apply,checks:evidence.checks,
  });
}
async function persistOutcome(s: RunState) {
  const final = {outcome:s.phase,runId:s.runId,change:s.pins.changeName,rounds:s.workers.filter(w=>w.role==='verifier').length,
    reason:s.reason,runDir:s.runDir,pending:s.pending ? {sessionId:s.pending.assignment.sessionId,role:s.pending.assignment.role} : undefined,
    workers:s.workers,requests:s.requests,activeMs:s.activeMs};
  await atomicWrite(join(s.runDir,'final.json'),final);
  await atomicWrite(join(s.runDir,'final.md'),`# OpenSpec verification loop: ${s.phase}\n\n${s.reason ?? ''}\n\nChange: ${s.pins.changeName}\nRun: ${s.runId}\nReports: ${join(s.runDir,'rounds')}\n`,true);
  return final;
}
export async function createRun(project: string, config: Config, adapter: Adapter, change?: string, options: LoopOptions = {}) {
  const target = await selectTarget(project, change);
  const pins = await pinTarget(target, config, adapter);
  const root = await ensureExternalState(config.stateDir ?? defaultStateRoot(), project, resolve(dirname(fileURLToPath(import.meta.url)),'..'));
  const runId = newId('run');
  const runDir = runDirectory(root, project, runId);
  const initial = await snapshot(project);
  const state: RunState = {schemaVersion:1,controllerVersion:VERSION,runId,runDir,project,config,pins,initial,
    phase:'preflight',nextRole:'verifier',round:1,createdAt:Date.now(),updatedAt:Date.now(),activeMs:0,
    prior:[],stalledCycles:0,workers:[]};
  const store = new RunStore(state, options.lockRoot);
  await store.acquire();
  try { await store.save(); } catch (e) { await store.release(false); throw e; }
  return executeLoop(store, adapter, options);
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
  const emit = (event: unknown) => options.emit?.(event);
  const save = async () => { s.activeMs = previousActive + Date.now() - started; await store.save(); };
  const terminate = async (outcome: RunState['phase'], reason: string, preservePending = false) => {
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
    delete s.reason; delete s.requests;
    emit({event:'started',runId:s.runId,runDir:s.runDir,change:s.pins.changeName});
    await checkPins(s.pins, s.config, adapter);
    while (true) {
      await guard();
      if (!s.pending) {
        if (s.config.maxRounds && s.round > s.config.maxRounds) throw new LoopError('limited', 'Verification round limit reached');
        await checkPins(s.pins, s.config, adapter);
        const role = s.nextRole;
        const evidence = role === 'verifier' ? await gatherEvidence(s.pins, s.config, workSignal) : undefined;
        if(evidence)s.taskContext=evidence.apply;
        const before = evidence?.after ?? await snapshot(s.project);
        const prompt = await workerPrompt(s, role, evidence);
        await persistEvidence(s,s.round,evidence);
        if (Buffer.byteLength(prompt) > 2 * 1024 * 1024) throw new LoopError('blocked', 'Complete worker context exceeds 2 MiB; reduce report/context size without dropping findings');
        const assignment: Assignment = {sessionId:newId('ses'),inputId:newId('msg'),project:s.project,runId:s.runId,
          role,round:s.round,agent:s.pins.agents[role],model:s.pins.models[role],prompt};
        s.pending = {assignment,stage:'prepared',before,...(evidence ? {evidence} : {})};
        s.phase = role === 'verifier' ? 'verifying' : 'fixing';
        s.workers.push({sessionId:assignment.sessionId,inputId:assignment.inputId,role,round:s.round});
        await save(); // Write-ahead identity and complete prompt precede all network mutation.
        await store.event('dispatch_prepared', {sessionId:assignment.sessionId,role,round:s.round});
      }
      const pending = s.pending;
      const a = pending.assignment;
      s.phase = a.role === 'verifier' ? 'verifying' : 'fixing';
      if (pending.stage === 'prepared') {
        await adapter.ensureSession(a);
        pending.stage = 'created'; await save();
      }
      if (pending.stage === 'created') {
        pending.stage = 'admitting'; await save();
        await adapter.ensurePrompt(a, true);
        pending.stage = 'submitted'; await save();
      } else if (pending.stage === 'admitting') {
        await adapter.ensurePrompt(a, false);
        pending.stage = 'submitted'; await save();
      }
      emit({event:'worker',role:a.role,round:a.round,sessionId:a.sessionId,inputId:a.inputId});
      const progress = new AbortController();
      const subscription = adapter.subscribe?.(a.sessionId, progress.signal, type => emit({event:'progress',role:a.role,round:a.round,type}));
      let observation;
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
      await mkdir(roundDir, {recursive:true});
      await atomicWrite(join(roundDir, `${a.role}.raw.json`), {sessionId:a.sessionId,inputId:a.inputId,messageId:observation.messageId,text:observation.text});
      await persistEvidence(s,a.round,pending.evidence);
      if(pending.evidence)s.taskContext=pending.evidence.apply;
      await checkPins(s.pins, s.config, adapter);
      const after = await snapshot(s.project);
      await guard();
      if(after.head!==pending.before.head) throw new LoopError('blocked','Checkout HEAD changed during the worker assignment; committing or switching branches is outside this loop');
      if (a.role === 'verifier' && pending.before.hash !== after.hash) {
        throw new LoopError('blocked', `Checkout changed during verification: ${changedFiles(pending.before, after).join(', ')}; a fresh reviewed run is required`);
      }
      const report = parseReport(observation.text, a.role, {runId:s.runId,round:a.round,changeName:s.pins.changeName,targetPath:s.pins.targetPath}, s.prior);
      await atomicWrite(join(roundDir, `${a.role}.json`), {sessionId:a.sessionId,inputId:a.inputId,messageId:observation.messageId,workspace:after.hash,report});
      await atomicWrite(join(roundDir, `${a.role}.md`), report.fullReportMarkdown, true);
      delete s.pending;
      await store.event('report_accepted', {role:a.role,round:a.round,messageId:observation.messageId});
      if (report.role === 'verifier') {
        s.verifier = report;
        const repairs = needsRepair(report, s.prior);
        if (report.outcome === 'blocked' || report.blockers.length) {
          await terminate('blocked', report.blockers.join('; ')); break;
        }
        if (report.outcome === 'clean') {
          const failures = pending.evidence ? evidenceFailures(pending.evidence) : ['No independent check evidence'];
          if (failures.length) throw new Error(`Clean report contradicts independent evidence: ${failures.join('; ')}`);
          s.phase = 'clean'; s.reason = 'Fresh full verification has zero findings and all applicable checks are verified';
          s.prior = []; await save(); break;
        }
        s.prior = repairs;
        s.nextRole = 'fixer';
        emit({event:'findings',round:s.round,count:repairs.length});
      } else {
        s.fixer = report;
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
    await terminate(phase, timer?.aborted && !options.signal?.aborted ? 'Time limit reached' : errorMessage(e), s.pending?.stage === 'admitting');
  } finally {
    const final = await persistOutcome(s);
    await store.release(Boolean(s.pending));
    emit(final);
  }
  return s;
}

export async function resumeRun(store: RunStore, adapter: Adapter, options: LoopOptions = {}) {
  if (store.state.phase === 'clean') {
    // A crash after persisting clean but before releasing its reservation must remain recoverable.
    await store.acquire(true);
    try {await persistOutcome(store.state);} finally {await store.release(false);}
    throw new LoopError('blocked', 'This run is already clean; its reservation is released. Start a new run to verify again');
  }
  await store.acquire(true);
  await rm(join(store.state.runDir,'stop.request'), {force:true});
  if (!store.state.pending) {
    store.state.round = Math.max(store.state.round, ...store.state.workers.map(w=>w.round + 1));
    store.state.nextRole = 'verifier';
    store.state.stalledCycles = 0;
  }
  return executeLoop(store, adapter, options);
}

/** A dead controller is recovered under the same checkout lease before cancellation. */
export async function stopRun(store: RunStore, adapter?: Adapter) {
  await store.acquire(true);
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
    }
    if (store.state.pending && (!adapter || !await adapter.interrupt(store.state.pending.assignment))) {
      throw new LoopError('blocked', 'Worker termination is unconfirmed; checkout remains reserved');
    }
    delete store.state.pending;
    store.state.nextRole = 'verifier';
    store.state.phase = 'interrupted'; store.state.reason = 'Stopped by user';
    await store.save();
    await persistOutcome(store.state);
  } finally { await store.release(Boolean(store.state.pending)); }
  return store.state;
}
