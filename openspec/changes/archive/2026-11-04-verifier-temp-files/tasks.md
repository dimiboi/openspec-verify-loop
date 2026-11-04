# Tasks

## 1. Verifier rule

- [x] 1.1 In `skills/openspec-verify-loop/verify-loop.js`, replace the verifier line "Do not edit, create or delete any files, including through the shell." with a rule that forbids editing, creating or deleting files in the checkout, including through the shell, and allows temporary files outside it, such as under `$TMPDIR` or `/tmp`. Verify with 1.2.
- [x] 1.2 In `tests/loop.test.ts`, assert in the worker-rules test that only verifier prompts carry the checkout no-edit rule and the temporary-file permission. Verify `npx tsx --test tests/loop.test.ts` passes.
- [x] 1.3 Update the worker rules in `README.md` and the loop-script coverage list in `docs/verification.md`. Verify by reading that they match this change's spec.

## 2. Checks

- [x] 2.1 Run `npm run check`, then `git diff --exit-code -- dist/index.js`, and verify both succeed.
- [x] 2.2 Run `bb workflows validate --script "$(cat skills/openspec-verify-loop/verify-loop.js)" --json`, verify it reports `"valid": true`, and record the result in the `docs/verification.md` table.
