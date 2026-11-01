import { digest, VERSION } from './util.js';
import type { AgentInfo } from '@opencode/client';

export type Role = 'verifier' | 'fixer';
export type Permission = {action: string; resource: string; effect: 'allow' | 'deny' | 'ask'};
export const MANAGEMENT_TOOL = 'openspec_verify_loop';
// Context format changes invalidate recovery under an older worker assignment policy.
const promptContextVersion = 2;
export const workerInstructions: Record<Role, string> = {
  verifier: 'Perform one inspection assignment. Execute the pinned verification procedure in full. Leave source, task tracking, requirements, and archival state unchanged. Shell access is permission-controlled, not a filesystem sandbox; do not bypass edit restrictions through the shell.',
  fixer: 'Address every supplied finding and missing check evidence. Preserve unrelated work and run relevant checks. Do not weaken tests, requirements, or approved scope to manufacture a clean result. Requirements/design decisions and external prerequisites are blockers.',
};
export const commonInstructions = 'The controller owns sequencing. Do not launch workers, invoke openspec_verify_loop, commit, push, merge, deploy, sync specs, or archive. Follow repository instructions. Scope searches to relevant source/tests, read focused ranges, and quote shell globs. Review committed implementation even when git status is clean. Keep lengthy command output in logs outside the checkout; preserve the actual command exit status when limiting displayed output. Complete only this assignment and return exactly the requested report.';

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
