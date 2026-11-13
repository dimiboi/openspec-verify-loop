import { z } from 'zod';

export const changeName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const storeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const maxRounds = z.number().int().positive();
export const startArgumentsSchema = z.strictObject({
  change: changeName.optional(),
  store: storeId.optional(),
  maxRounds: maxRounds.optional(),
});
export type StartArguments = z.infer<typeof startArgumentsSchema>;
