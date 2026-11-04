export type Role = 'verifier' | 'fixer';
export type Permission = {action: string; resource: string; effect: 'allow' | 'deny' | 'ask'};
export const MANAGEMENT_TOOL = 'openspec_verify_loop';

/** Verifiers cannot use the edit tool; no worker can delegate or manage loops. */
export function workerPermissions(role: Role): Permission[] {
  return [
    ...(role === 'verifier' ? [{action: 'edit', resource: '*', effect: 'deny'} as Permission] : []),
    {action: 'subagent', resource: '*', effect: 'deny'},
    {action: MANAGEMENT_TOOL, resource: '*', effect: 'deny'},
  ];
}
