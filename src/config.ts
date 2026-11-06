import { z } from 'zod';

export const configSchema = z.strictObject({
  server: z.url().optional(),
  maxRounds: z.number().int().positive().optional(),
});
