import { z } from 'zod';

const text = z.string().trim().min(1);
const evidence = z.array(text);
const common = {
  schemaVersion: z.literal(2), runId: text, round: z.number().int().positive(),
  changeName: text, targetPath: text, blockers: z.array(text), fullReportMarkdown: text,
};
export const findingSchema = z.strictObject({
  id: text, severity: z.enum(['critical', 'warning', 'suggestion']), category: text,
  title: text, explanation: text, locations: z.array(text), recommendation: text,
});
// The verifier copies the procedure's own issues and skipped checks; the controller derives the outcome.
export const verifierSchema = z.strictObject({
  ...common, role: z.literal('verifier'), verificationComplete: z.boolean(), findings: z.array(findingSchema),
  notVerified: z.array(z.strictObject({check: text, reason: text, repairable: z.boolean()})),
  priorFindingResolutions: z.array(z.strictObject({
    findingId: text, status: z.enum(['resolved', 'unresolved', 'not_applicable']), evidence, reason: z.string(),
  })),
});
export const fixerSchema = z.strictObject({
  ...common, role: z.literal('fixer'), outcome: z.enum(['completed', 'blocked']),
  addressedFindings: z.array(z.strictObject({findingId: text, evidence})),
  unresolvedFindings: z.array(z.strictObject({findingId: text, reason: text})),
  // A dispute is a disposition, not a resolution: the next fresh verifier decides it.
  disputedFindings: z.array(z.strictObject({findingId: text, evidence})).default([]),
  changedFiles: z.array(text),
  checksRun: z.array(z.strictObject({
    command: z.array(text).min(1), workingDirectory: text, exitCode: z.number().int(), evidence, summary: text,
  })),
});
export type Finding = z.infer<typeof findingSchema>;
export type VerifierOutcome = 'clean' | 'findings' | 'blocked';
export type VerifierReport = z.infer<typeof verifierSchema> & {outcome: VerifierOutcome};
export type FixerReport = z.infer<typeof fixerSchema>;
export type Report = VerifierReport | FixerReport;
export type Identity = {runId: string; round: number; changeName: string; targetPath: string};

function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label}`);
}

export function parseReport(raw: string, role: Report['role'], expected: Identity, prior: Finding[]): Report {
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('Report exceeds 8 MiB');
  // A whole fenced JSON response is acceptable; surrounding commentary or multiple objects are not.
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/.exec(trimmed);
  const value = JSON.parse(fenced?.[1] ?? trimmed);
  if (Array.isArray(value?.findings)) {
    for (const f of value.findings) {
      if (typeof f?.severity === 'string') {
        const severity = f.severity.toLowerCase();
        f.severity = ['recommendation', 'recommendations'].includes(severity) ? 'suggestion' : severity;
      }
    }
  }
  // The outcome is derived below; a model-supplied verdict is ignored rather than trusted.
  if (role === 'verifier' && value && typeof value === 'object') delete value.outcome;
  const report: Report = role === 'verifier' ? {...verifierSchema.parse(value), outcome: 'findings'} : fixerSchema.parse(value);
  for (const key of ['runId', 'round', 'changeName', 'targetPath'] as const) {
    if (report[key] !== expected[key]) throw new Error(`Report ${key} does not match pending assignment`);
  }
  if (report.role === 'verifier') {
    // Models renumber findings each round; a new finding reusing a closed prior ID is still a distinct finding.
    const closed = new Set(report.priorFindingResolutions.filter(p => p.status !== 'unresolved').map(p => p.findingId));
    for (const finding of report.findings) if (closed.has(finding.id)) finding.id = `${finding.id}-r${report.round}`;
    validateVerifier(report, prior);
    report.outcome = verifierOutcome(report);
  } else validateFixer(report, prior);
  return report;
}

/** Clean also requires passing controller evidence; the controller downgrades clean when that fails. */
export function verifierOutcome(r: Omit<VerifierReport, 'outcome'>): VerifierOutcome {
  if (r.blockers.length || r.notVerified.some(c => !c.repairable)) return 'blocked';
  return r.verificationComplete && !r.findings.length && !r.notVerified.length &&
    r.priorFindingResolutions.every(p => p.status !== 'unresolved') ? 'clean' : 'findings';
}

function validateVerifier(r: VerifierReport, prior: Finding[]) {
  unique(r.findings.map(f => f.id), 'finding IDs');
  unique(r.notVerified.map(c => c.check), 'not-verified checks');
  unique(r.priorFindingResolutions.map(p => p.findingId), 'prior resolutions');
  const priorIds = new Set(prior.map(f => f.id));
  for (const resolution of r.priorFindingResolutions) {
    if (!priorIds.has(resolution.findingId)) throw new Error(`Unknown prior finding ${resolution.findingId}`);
    if (resolution.status === 'resolved' && !resolution.evidence.length) throw new Error('Resolution lacks evidence');
    if (resolution.status !== 'resolved' && !resolution.reason.trim()) throw new Error('Resolution lacks a reason');
  }
  for (const finding of prior) {
    if (!r.priorFindingResolutions.some(p => p.findingId === finding.id)) {
      throw new Error(`Missing resolution for prior finding ${finding.id}`);
    }
  }
}

function validateFixer(r: FixerReport, prior: Finding[]) {
  const ids = [...r.addressedFindings, ...r.unresolvedFindings, ...r.disputedFindings].map(f => f.findingId);
  unique(ids, 'fix dispositions');
  for (const id of ids) if (!prior.some(f => f.id === id)) throw new Error(`Unknown fixer finding ${id}`);
  for (const f of prior) if (!ids.includes(f.id)) throw new Error(`Fixer omitted finding ${f.id}`);
  if ([...r.addressedFindings, ...r.disputedFindings].some(f => !f.evidence.length)) throw new Error('Fix or dispute lacks evidence');
  if (r.outcome === 'completed' && (r.unresolvedFindings.length || r.blockers.length || r.checksRun.some(c => c.exitCode !== 0))) {
    throw new Error('Completed fixer still has unresolved work or failed checks');
  }
  if (r.outcome === 'blocked' && !r.blockers.length && !r.unresolvedFindings.length) throw new Error('Blocked fixer lacks explanation');
}

/** Missing evidence and failed controller checks are made explicit and carried to the fixer, never discarded. */
export function needsRepair(r: VerifierReport, prior: Finding[], evidenceFailures: string[] = []): Finding[] {
  const result = [...r.findings];
  const add = (f: Finding) => { if (!result.some(x => x.id === f.id)) result.push(f); };
  for (const p of r.priorFindingResolutions.filter(p => p.status === 'unresolved')) {
    const f = prior.find(f => f.id === p.findingId);
    if (f) add(f);
  }
  for (const c of r.notVerified.filter(c => c.repairable)) {
    add({id: `check:${c.check}`, severity: 'warning', category: 'verification', title: `Not verified: ${c.check}`,
      explanation: c.reason, locations: [], recommendation: 'Repair the check or provide the missing verification evidence.'});
  }
  // IDs come from the failure text so a still-failing check keeps its ID and distinct failures never collide.
  for (const failure of evidenceFailures) add({id: `evidence:${failure.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, severity: 'critical', category: 'verification',
    title: failure, explanation: 'The controller\'s independent check evidence failed; see the saved checks.json.', locations: [],
    recommendation: 'Make the failing check pass (including any documented dependency setup) without weakening it.'});
  if (!r.verificationComplete) add({id: 'verification:incomplete', severity: 'warning', category: 'verification',
    title: 'Verification incomplete', explanation: 'The full verification procedure was not completed.', locations: [],
    recommendation: 'Repair the missing prerequisites/evidence for a full verification.'});
  return result;
}

export function reportJsonSchema(role: Report['role']) {
  return z.toJSONSchema(role === 'verifier' ? verifierSchema : fixerSchema);
}
