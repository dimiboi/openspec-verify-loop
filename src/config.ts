import { z } from 'zod';
import { maxRounds } from './arguments.js';

export const configSchema = z.strictObject({
  server: z.url().optional(),
  maxRounds: maxRounds.optional(),
});
