import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exists } from './util.js';

export const configSchema = z.strictObject({
  verifierModel: z.string().min(3).optional(), fixerModel: z.string().min(3).optional(),
  skill: z.string().min(1).optional(), server: z.url().optional(), stateDir: z.string().min(1).optional(),
  maxRounds: z.number().int().positive().optional(), maxMinutes: z.number().positive().optional(),
  checks: z.array(z.strictObject({id: z.string().min(1), command: z.array(z.string().min(1)).min(1),
    cwd: z.string().optional(), timeoutMs: z.number().int().positive().default(120_000)})).default([]),
});
export type Config = z.infer<typeof configSchema>;
export async function loadConfig(project: string, overrides: Record<string, unknown>) {
  const path = resolve(project, '.opencode/openspec-verify-loop.json');
  const local: unknown = await exists(path) ? JSON.parse(await readFile(path, 'utf8')) : {};
  const parsed = configSchema.parse(local);
  const effective = configSchema.parse({...parsed, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined))});
  if (new Set(effective.checks.map(c => c.id)).size !== effective.checks.length) throw new Error('Duplicate required check IDs');
  return effective;
}
