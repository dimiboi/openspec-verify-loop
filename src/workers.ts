import { digest, VERSION } from './util.js';
import type { AgentInfo } from '@opencode/client';

export type Role = 'verifier' | 'fixer';
export type Permission = {action: string; resource: string; effect: 'allow' | 'deny' | 'ask'};
export const MANAGEMENT_TOOL = 'openspec_verify_loop';
// Context format changes invalidate recovery under an older worker assignment policy.
const promptContextVersion = 3;
export const workerInstructions: Record<Role, string> = {
  verifier: 'Perform one inspection assignment. Execute the pinned verification procedure in full. Leave source, task tracking, requirements, and archival state unchanged. Shell access is permission-controlled, not a filesystem sandbox; do not bypass edit restrictions through the shell.',
  fixer: 'Address every supplied finding and missing check evidence with small, checked edits. Preserve unrelated work. Do not weaken tests, requirements, or approved scope to manufacture a clean result. Dispute an incorrect finding with evidence; unsettled requirements decisions and external prerequisites are blockers.',
};
export const commonInstructions = 'The controller owns sequencing. Do not launch workers, invoke openspec_verify_loop, commit, push, merge, deploy, sync specs, or archive. Do not inspect other sessions, loop state, or orchestration tooling; use only the supplied report paths. Follow repository instructions. Navigation: first get the implementation\'s changed-file map (git log/show --stat for the change\'s commits, git diff --stat for uncommitted work) to target reads, not to limit review; review committed implementation even when git status is clean. Use exposed symbol tools (e.g. Serena) for code symbols and rg -n scoped to source/test directories for CSS, config, and test text; quote shell globs. Read bounded ranges around hits, never re-read a range already in context, and narrow any search that hits a result cap. Keep lengthy command output in logs outside the checkout; preserve the actual exit status when limiting output and do not hide stderr. Complete only this assignment and return exactly the requested report.';

export function workerPermissions(role: Role, base: readonly Permission[] = []): Permission[] {
  return [
    ...(role === 'verifier' ? [
      {action: 'shell', resource: '*', effect: 'ask'} as Permission,
      ...['git status', 'git diff', 'git log', 'git show', 'git ls-files',
        'openspec list', 'openspec status', 'openspec instructions', 'openspec validate'].map(command =>
        ({action: 'shell', resource: `${command}*`, effect: 'allow'} as Permission)),
      // Role inspection exceptions must never grant access forbidden by the project.
      ...base.filter(rule => ['shell', '*'].includes(rule.action) && rule.effect !== 'allow'),
      {action: 'edit', resource: '*', effect: 'deny'} as Permission,
    ] : []),
    {action: 'subagent', resource: '*', effect: 'deny'},
    {action: MANAGEMENT_TOOL, resource: '*', effect: 'deny'},
  ];
}

export function workerPolicyDigest(build: AgentInfo) {
  return digest(JSON.stringify({version: VERSION, promptContextVersion, build, workerInstructions, commonInstructions,
    verifier: workerPermissions('verifier', build.permissions), fixer: workerPermissions('fixer', build.permissions)}));
}
