import { z } from 'zod';
import { resolve } from 'node:path';

export const configSchema = z.strictObject({
  verifierModel: z.string().min(3).optional(), fixerModel: z.string().min(3).optional(),
  skill: z.string().min(1).optional(), server: z.url().optional(), stateDir: z.string().min(1).optional(),
  maxRounds: z.number().int().positive().optional(), maxMinutes: z.number().positive().optional(),
  checks: z.array(z.strictObject({id: z.string().min(1), command: z.array(z.string().min(1)).min(1),
    cwd: z.string().optional(), timeoutMs: z.number().int().positive().default(120_000)})).default([]),
}).refine(c => new Set(c.checks.map(check => check.id)).size === c.checks.length, 'Duplicate required check IDs');
export type Config = z.infer<typeof configSchema>;
export function resolveConfig(options: unknown, project: string): Config {
  const config = configSchema.parse(options);
  if (config.stateDir) config.stateDir = resolve(project, config.stateDir);
  if (config.skill) config.skill = resolve(project, config.skill);
  return config;
}
