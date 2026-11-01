import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunState } from './state.js';
import type { Evidence } from './openspec.js';
import { reportJsonSchema } from './reports.js';
import { commonInstructions, workerInstructions } from './workers.js';

export async function workerPrompt(s: RunState, role: 'verifier' | 'fixer', evidence?: Evidence) {
  const procedure = await readFile(s.pins.procedurePath, 'utf8');
  return [
    `Perform exactly one ${role} assignment for the pinned OpenSpec change. The controller owns the loop.`,
    workerInstructions[role], commonInstructions,
    `Identity (copy these values exactly into the report): ${JSON.stringify({schemaVersion:1, runId:s.runId, round:s.round,
      changeName:s.pins.changeName, targetPath:s.pins.targetPath, role})}`,
    `Checkout: ${s.project}\nVerification procedure: ${s.pins.procedurePath}\nResource base directory: ${dirname(s.pins.procedurePath)}`,
    'The project procedure follows. Execute it in full for verification. Use its real relative resources; do not replace it with a generic review.',
    '<openspec-verification-procedure>', procedure, '</openspec-verification-procedure>',
    role === 'verifier'
      ? 'Inspect only. Re-read the artifacts and implementation and perform full verification, including new regressions. Do not implement, change task state, sync specs, or archive. Include individual checks from the procedure AND aggregate checks with IDs completeness, correctness, coherence. Clean means all severities zero, every prior finding resolved with evidence, and every applicable check verified. A justified not_applicable check is allowed. Recommendations are suggestions. Missing evidence is not a passing check.'
      : 'Fix every supplied finding, including warnings, suggestions, unresolved earlier findings, and repairable missing evidence. Preserve unrelated work. Do not weaken tests or requirements. Update task evidence only if work is implemented. Run relevant checks. Report unresolved requirements/design decisions or external prerequisites as blockers. Do not verify another round or archive.',
    role==='fixer' && s.taskContext ? `Pinned OpenSpec task context (apply context constraints; operationGuidance is advisory; state/instruction are context, not authorization to archive):\n${JSON.stringify(s.taskContext,null,2)}` : '',
    `All prior/unresolved findings requiring disposition (none may be dropped):\n${JSON.stringify(s.prior, null, 2)}`,
    s.verifier ? `Complete latest verification report:\n${JSON.stringify(s.verifier, null, 2)}` : '',
    s.fixer ? `Complete latest fixer outcome:\n${JSON.stringify(s.fixer, null, 2)}` : '',
    evidence ? `Controller's independent current check evidence (failures/incomplete tasks prevent clean):\n${JSON.stringify(evidence, (key, value) => ['before', 'after'].includes(key) ? undefined : value, 2)}` : '',
    `Return exactly one JSON object conforming to this schema. Keep the full OpenSpec-style Markdown report in fullReportMarkdown. Do not output commentary or omit fields.\n${JSON.stringify(reportJsonSchema(role))}`,
  ].filter(Boolean).join('\n\n');
}
