import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RunState } from './state.js';
import type { Evidence } from './openspec.js';
import type { CommandResult } from './util.js';
import { reportJsonSchema } from './reports.js';
import { commonInstructions, workerInstructions } from './workers.js';

const outputExcerptLength = 2400;
function outputExcerpt(output: string) {
  const omittedCharacters = Math.max(0, output.length - outputExcerptLength);
  return {text: omittedCharacters
    ? `${output.slice(0, outputExcerptLength / 2)}\n[Output omitted; see the saved checks.json.]\n${output.slice(-outputExcerptLength / 2)}`
    : output, omittedCharacters};
}
function commandEvidence(result: CommandResult) {
  return {command: result.command, workingDirectory: result.workingDirectory, exitCode: result.exitCode,
    status: result.exitCode === 0 ? 'passed' : 'failed', stdout: outputExcerpt(result.stdout), stderr: outputExcerpt(result.stderr)};
}
function roundDirectory(s: RunState, round: number) {
  return join(s.runDir, 'rounds', String(round).padStart(3, '0'));
}
function reportPaths(s: RunState, role: 'verifier' | 'fixer', round: number) {
  const directory = roundDirectory(s, round);
  return {role, round, json: join(directory, `${role}.json`), markdown: join(directory, `${role}.md`),
    raw: join(directory, `${role}.raw.json`), ...(role === 'verifier' ? {checks: join(directory, 'checks.json')} : {})};
}

export async function workerPrompt(s: RunState, role: 'verifier' | 'fixer', evidence?: Evidence) {
  const procedure = role === 'verifier' ? await readFile(s.pins.procedurePath, 'utf8') : undefined;
  const verifier = s.verifier;
  const fixer = s.fixer;
  return [
    `Perform exactly one ${role} assignment for the pinned OpenSpec change. The controller owns the loop.`,
    workerInstructions[role], commonInstructions,
    `Identity (copy these values exactly into the report): ${JSON.stringify({schemaVersion:1, runId:s.runId, round:s.round,
      changeName:s.pins.changeName, targetPath:s.pins.targetPath, role})}`,
    `Checkout: ${s.project}\nVerification procedure: ${s.pins.procedurePath}\nResource base directory: ${dirname(s.pins.procedurePath)}\nPinned procedure/resource digest: ${s.pins.procedureDigest}`,
    role === 'verifier'
      ? `The authoritative pinned verification procedure is already loaded below. Execute it in full; do not rediscover or reread its entrypoint. Read referenced relative resources from the resource base directory when needed.\n<openspec-verification-procedure>\n${procedure}\n</openspec-verification-procedure>`
      : 'The change name and path above are pinned; do not rediscover them. Use the procedure path and resources only when a supplied finding needs that context.',
    role === 'verifier'
      ? 'Inspect only. Re-read the artifacts and implementation and perform full verification, including new regressions. Test/lint/build evidence comes from the controller\'s current checks below; run an additional procedure check only when new changes, failures, or uncertainty require it. Previous-round evidence cannot establish current success. Do not implement, change task state, sync specs, or archive. Put the procedure\'s normal report, unchanged, in fullReportMarkdown. Then copy each CRITICAL/WARNING/SUGGESTION issue from that report into findings with the severity it has there, and each check the report marks not verified or skipped into notVerified (repairable=false only for external prerequisites the fixer cannot provide). Checks the report marks Not applicable are not gaps; leave them out of notVerified. Do not reclassify issues, change severities, or rate dimensions for the loop; the controller derives the outcome. Report a still-present prior finding as unresolved under its original ID; give every new finding an ID that differs from all prior finding IDs. Re-check disputed findings independently and resolve or keep each one.'
      : 'Fix every supplied finding, including warnings, suggestions, unresolved earlier findings, and repairable missing evidence. Work in this order: (1) start from each finding\'s locations; (2) write a short repair plan naming the governing requirement, the minimal edit, and one concrete check for each open question; (3) settle open questions with evidence instead of more deliberation: a bounded code read, a test, an available documentation tool (e.g. Context7) for library/API behavior, or an available browser tool (e.g. Playwright) for layout/UI behavior; (4) apply a small reversible edit, run its check, and reopen the choice only when a check gives new evidence. A fresh verifier judges the result next round; do not try to pre-empt every possible objection. When the change\'s own artifacts conflict, follow the reading the proposal/specs support, make the artifact wording consistent, and say so. If a finding is wrong or contradicts an agreed requirement, put it in disputedFindings with concrete evidence instead of forcing a change. Preserve unrelated work. Do not weaken tests or requirements. Update task evidence only if work is implemented. Report requirements decisions no artifact settles, or external prerequisites, as blockers. Do not verify another round or archive.',
    role==='fixer' && s.taskContext ? `Pinned OpenSpec task context (apply context constraints; operationGuidance is advisory; state/instruction are context, not authorization to archive):\n${JSON.stringify(s.taskContext,null,2)}` : '',
    `All prior/unresolved findings requiring disposition (none may be dropped):\n${JSON.stringify(s.prior, null, 2)}`,
    verifier ? `Latest verification gaps and resolutions (findings are supplied once above; check prior evidence against the current workspace):\n${JSON.stringify({round:verifier.round,
      verificationComplete:verifier.verificationComplete,notVerified:verifier.notVerified,
      priorFindingResolutions:verifier.priorFindingResolutions,blockers:verifier.blockers},null,2)}` : '',
    role==='verifier' && fixer ? `Latest fixer dispositions (claims require independent verification):\n${JSON.stringify({round:fixer.round,outcome:fixer.outcome,
      addressedFindings:fixer.addressedFindings,unresolvedFindings:fixer.unresolvedFindings,disputedFindings:fixer.disputedFindings,changedFiles:fixer.changedFiles,
      checksRun:fixer.checksRun,blockers:fixer.blockers},null,2)}` : '',
    verifier || fixer ? `Complete JSON, Markdown, and raw reports remain saved at these paths; consult them for additional detail:\n${JSON.stringify([
      ...(verifier ? [reportPaths(s,'verifier',verifier.round)] : []),
      ...(fixer ? [reportPaths(s,'fixer',fixer.round)] : []),
    ],null,2)}` : '',
    evidence ? `Controller's independent current check evidence (failures/incomplete tasks prevent clean; excerpts retain actual exit status; full output is saved):\n${JSON.stringify({
      workspace:evidence.after.hash,checksPath:join(roundDirectory(s,s.round),'checks.json'),
      validation:commandEvidence(evidence.validation),apply:evidence.apply,
      checks:evidence.checks.map((check,index)=>({id:s.config.checks[index]?.id,...commandEvidence(check)})),
    },null,2)}` : '',
    `Return exactly one JSON object conforming to this schema. Keep the full OpenSpec-style Markdown report in fullReportMarkdown. Do not output commentary or omit fields.\n${JSON.stringify(reportJsonSchema(role))}`,
  ].filter(Boolean).join('\n\n');
}
