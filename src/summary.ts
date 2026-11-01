import { join } from 'node:path';
import type { FixerReport, VerifierReport } from './reports.js';
import type { RunState, Worker, WorkerProgress } from './state.js';

const stages: WorkerProgress[] = ['prepared', 'submitted', 'completed', 'accepted'];
const markdownDestination = (path: string) => `<${path.replaceAll('%', '%25').replaceAll('<', '%3C').replaceAll('>', '%3E')}>`;
function progressFor(state: RunState, worker: Worker): WorkerProgress {
  if (worker.progress) return worker.progress;
  // Older schema-2 runs have no lifecycle fields. Only saved, accepted reports
  // and a known submitted pending input establish progress beyond preparation.
  const report = worker.role === 'verifier' ? state.verifier : state.fixer;
  if (report?.round === worker.round) return 'accepted';
  if (state.pending?.assignment.sessionId === worker.sessionId && state.pending.stage === 'submitted') return 'submitted';
  return 'prepared';
}
function reportLocation(state: RunState, report: VerifierReport | FixerReport | undefined) {
  if (!report) return undefined;
  const path = join(state.runDir, 'rounds', String(report.round).padStart(3, '0'), report.role);
  return {round: report.round, outcome: report.outcome, json: `${path}.json`, markdown: `${path}.md`};
}
function completedLocation(state: RunState, role: Worker['role']) {
  const worker = state.workers.findLast(worker => worker.role === role && stages.indexOf(progressFor(state, worker)) >= stages.indexOf('completed'));
  return worker ? {round:worker.round, raw:join(state.runDir, 'rounds', String(worker.round).padStart(3, '0'), `${role}.raw.json`)} : undefined;
}

/** The same saved evidence powers status, notices, and both final reports. */
export function runSummary(state: RunState) {
  const progress = Object.fromEntries((['verifier', 'fixer'] as const).map(role => {
    const workers = state.workers.filter(worker => worker.role === role);
    return [role, Object.fromEntries(stages.map((stage, index) => [stage,
      workers.filter(worker => stages.indexOf(progressFor(state, worker)) >= index).length,
    ])) as Record<WorkerProgress, number>];
  })) as Record<'verifier' | 'fixer', Record<WorkerProgress, number>>;
  const unresolvedSeverityCounts = {critical: 0, warning: 0, suggestion: 0};
  for (const finding of state.prior) unresolvedSeverityCounts[finding.severity]++;
  return {outcome: state.phase, runId: state.runId, runDir: state.runDir, change: state.pins.changeName,
    round: state.round, rounds: progress.verifier.accepted, reason: state.reason, failure: state.failure,
    finalizationFailure: state.finalizationFailure,
    executor: state.executor, requests: state.requests,
    pending: state.pending ? {sessionId: state.pending.assignment.sessionId, inputId: state.pending.assignment.inputId,
      role: state.pending.assignment.role, round: state.pending.assignment.round, stage: state.pending.stage} : undefined,
    models: state.pins.models, workers: state.workers, progress,
    progressIncomplete: state.workers.some(worker => !worker.progress),
    unresolvedFindings: state.prior, unresolvedSeverityCounts,
    lastVerifier: reportLocation(state, state.verifier), lastFixer: reportLocation(state, state.fixer),
    lastCompletedVerifier: completedLocation(state, 'verifier'), lastCompletedFixer: completedLocation(state, 'fixer'),
    reports: join(state.runDir, 'rounds'), activeMs: state.activeMs};
}

export function summaryMarkdown(state: RunState) {
  const result = runSummary(state);
  const lines = [`# OpenSpec verification loop: ${result.outcome}`, '', result.reason ?? '', '',
    `Change: ${result.change}`, `Run: ${result.runId}`, `Reports: ${result.reports}`, '',
    ...(['verifier', 'fixer'] as const).map(role => {
      const counts = result.progress[role];
      return `${role}: ${counts.prepared} prepared, ${counts.submitted} submitted, ${counts.completed} completed, ${counts.accepted} reports accepted`;
    }), '', `Unresolved findings: ${state.prior.length} (${Object.entries(result.unresolvedSeverityCounts).map(([severity, count]) => `${count} ${severity}`).join(', ')})`];
  if (result.failure) lines.push('', `Failure: ${result.failure.role} round ${result.failure.round}, ${result.failure.stage}`, result.failure.error);
  if (result.finalizationFailure && (result.finalizationFailure.stage !== result.failure?.stage || result.finalizationFailure.error !== result.failure?.error)) {
    lines.push('', `Finalization failure: ${result.finalizationFailure.stage}`, result.finalizationFailure.error);
  }
  if (result.finalizationFailure?.cleanupError) lines.push('', `Ownership cleanup also failed: ${result.finalizationFailure.cleanupError}`);
  if (result.progressIncomplete) lines.push('', 'This older run lacks complete lifecycle records; counts include only saved or otherwise proven progress.');
  for (const finding of state.prior) lines.push('', `- ${finding.id} (${finding.severity}): ${finding.title}`);
  for (const [role, report] of [['verifier', result.lastVerifier], ['fixer', result.lastFixer]] as const) {
    if (report) lines.push('', `Last accepted ${role}: round ${report.round}, ${report.outcome}`, `[Report](${markdownDestination(report.markdown)})`);
  }
  for (const [role, completed] of [['verifier', result.lastCompletedVerifier], ['fixer', result.lastCompletedFixer]] as const) {
    if (completed) lines.push('', `Last completed ${role} output: round ${completed.round} [Raw output](${markdownDestination(completed.raw)})`);
  }
  if (result.pending) lines.push('', `Pending ${result.pending.role}: ${result.pending.sessionId} (${result.pending.stage}); checkout remains reserved`);
  lines.push('', 'Worker models:', ...(['verifier', 'fixer'] as const).map(role => {
    const model = result.models[role];
    return `${role}: ${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ''}`;
  }));
  return `${lines.join('\n')}\n`;
}
