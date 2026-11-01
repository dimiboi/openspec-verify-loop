import { z } from 'zod';

const text = z.string().trim().min(1);
const evidence = z.array(text);
const common = {
  schemaVersion: z.literal(1), runId: text, round: z.number().int().positive(),
  changeName: text, targetPath: text, blockers: z.array(text), fullReportMarkdown: text,
};
export const findingSchema = z.strictObject({
  id: text, severity: z.enum(['critical', 'warning', 'suggestion']), category: text,
  title: text, explanation: text, locations: z.array(text), recommendation: text,
});
export const verifierSchema = z.strictObject({
  ...common, role: z.literal('verifier'), verificationComplete: z.boolean(),
  outcome: z.enum(['clean', 'findings', 'blocked']), findings: z.array(findingSchema),
  checks: z.array(z.strictObject({
    id: text, description: text,
    status: z.enum(['verified', 'failed', 'not_verified', 'not_applicable']),
    evidence, reason: z.string(),
  })),
  priorFindingResolutions: z.array(z.strictObject({
    findingId: text, status: z.enum(['resolved', 'unresolved', 'not_applicable']), evidence, reason: z.string(),
  })),
});
export const fixerSchema = z.strictObject({
  ...common, role: z.literal('fixer'), outcome: z.enum(['completed', 'blocked']),
  addressedFindings: z.array(z.strictObject({findingId: text, evidence})),
  unresolvedFindings: z.array(z.strictObject({findingId: text, reason: text})),
  changedFiles: z.array(text),
  checksRun: z.array(z.strictObject({
    command: z.array(text).min(1), workingDirectory: text, exitCode: z.number().int(), evidence, summary: text,
  })),
});
export type Finding = z.infer<typeof findingSchema>;
export type VerifierReport = z.infer<typeof verifierSchema>;
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
  const report = role === 'verifier' ? verifierSchema.parse(value) : fixerSchema.parse(value);
  for (const key of ['runId', 'round', 'changeName', 'targetPath'] as const) {
    if (report[key] !== expected[key]) throw new Error(`Report ${key} does not match pending assignment`);
  }
  if (report.role === 'verifier') validateVerifier(report, prior);
  else validateFixer(report, prior);
  return report;
}

function validateVerifier(r: VerifierReport, prior: Finding[]) {
  unique(r.findings.map(f => f.id), 'finding IDs');
  unique(r.checks.map(c => c.id), 'check IDs');
  unique(r.priorFindingResolutions.map(p => p.findingId), 'prior resolutions');
  for (const check of r.checks) {
    if (check.status === 'verified' && !check.evidence.length) throw new Error(`Check ${check.id} lacks evidence`);
    if (check.status !== 'verified' && !check.reason.trim()) throw new Error(`Check ${check.id} lacks a reason`);
  }
  const priorIds = new Set(prior.map(f => f.id));
  for (const resolution of r.priorFindingResolutions) {
    if (!priorIds.has(resolution.findingId)) throw new Error(`Unknown prior finding ${resolution.findingId}`);
    if (resolution.status === 'resolved' && !resolution.evidence.length) throw new Error('Resolution lacks evidence');
    if (resolution.status !== 'resolved' && !resolution.reason.trim()) throw new Error('Resolution lacks a reason');
    if (resolution.status !== 'unresolved' && r.findings.some(f => f.id === resolution.findingId)) {
      throw new Error('Resolved finding still appears in findings');
    }
  }
  for (const finding of prior) {
    if (!r.priorFindingResolutions.some(p => p.findingId === finding.id)) {
      throw new Error(`Missing resolution for prior finding ${finding.id}`);
    }
  }
  if (r.outcome === 'blocked' && !r.blockers.length) throw new Error('Blocked report lacks blockers');
  if (r.outcome === 'clean') {
    const dimensions = ['completeness', 'correctness', 'coherence'];
    if (!r.verificationComplete || r.findings.length || r.blockers.length ||
        r.checks.some(c => !['verified', 'not_applicable'].includes(c.status)) ||
        r.priorFindingResolutions.some(p => p.status === 'unresolved') ||
        dimensions.some(id => !r.checks.some(c => c.id === id))) {
      throw new Error('Contradictory or incomplete clean report');
    }
  }
  if (r.outcome === 'findings' && !needsRepair(r, prior).length && !r.blockers.length) {
    throw new Error('Findings outcome has no actionable finding or missing evidence');
  }
}

function validateFixer(r: FixerReport, prior: Finding[]) {
  const ids = [...r.addressedFindings.map(f => f.findingId), ...r.unresolvedFindings.map(f => f.findingId)];
  unique(ids, 'fix dispositions');
  for (const id of ids) if (!prior.some(f => f.id === id)) throw new Error(`Unknown fixer finding ${id}`);
  for (const f of prior) if (!ids.includes(f.id)) throw new Error(`Fixer omitted finding ${f.id}`);
  if (r.addressedFindings.some(f => !f.evidence.length)) throw new Error('Fix lacks evidence');
  if (r.outcome === 'completed' && (r.unresolvedFindings.length || r.blockers.length || r.checksRun.some(c => c.exitCode !== 0))) {
    throw new Error('Completed fixer still has unresolved work or failed checks');
  }
  if (r.outcome === 'blocked' && !r.blockers.length && !r.unresolvedFindings.length) throw new Error('Blocked fixer lacks explanation');
}

/** Missing evidence is made explicit and carried to the fixer, never discarded. */
export function needsRepair(r: VerifierReport, prior: Finding[]): Finding[] {
  const result = [...r.findings];
  const add = (f: Finding) => { if (!result.some(x => x.id === f.id)) result.push(f); };
  for (const p of r.priorFindingResolutions.filter(p => p.status === 'unresolved')) {
    const f = prior.find(f => f.id === p.findingId);
    if (f) add(f);
  }
  for (const c of r.checks.filter(c => ['failed', 'not_verified'].includes(c.status))) {
    add({id: `check:${c.id}`, severity: 'warning', category: 'verification', title: c.description,
      explanation: c.reason, locations: [], recommendation: 'Repair the check or provide the missing verification evidence.'});
  }
  for (const id of ['completeness', 'correctness', 'coherence']) {
    if (!r.checks.some(c => c.id === id)) add({id: `dimension:${id}`, severity: 'warning', category: 'verification',
      title: `Missing ${id} verification`, explanation: 'Required verification dimension was not reported.',
      locations: [], recommendation: 'Provide the missing verification evidence.'});
  }
  if (!r.verificationComplete) add({id: 'verification:incomplete', severity: 'warning', category: 'verification',
    title: 'Verification incomplete', explanation: 'The full verification procedure was not completed.', locations: [],
    recommendation: 'Repair the missing prerequisites/evidence for a full verification.'});
  return result;
}

export function reportJsonSchema(role: Report['role']) {
  return z.toJSONSchema(role === 'verifier' ? verifierSchema : fixerSchema);
}
