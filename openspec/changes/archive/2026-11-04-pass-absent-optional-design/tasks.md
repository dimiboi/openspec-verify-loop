# Tasks

## 1. Verifier rule

- [x] 1.1 In `skills/openspec-verify-loop/verify-loop.js`, add a verifier-prompt line: a change without `design.md` has omitted an optional document, so mark Design Adherence Not applicable, not Not verified, and do not use the words "not verified" for it; a change with `design.md` is checked against it as usual. Verify with 1.2, and confirm by reading that the fixer prompt is unchanged.
- [x] 1.2 In `tests/loop.test.ts`, assert in the worker-rules test that only verifier prompts carry the absent-design rule. Add a test that a report labelling Design Adherence Not applicable and ending `VERDICT: CLEAN` ends `clean`. Change the `UNVERIFIED` fixture to a test run that could not run. Verify `npx tsx --test tests/loop.test.ts` passes.
- [x] 1.3 Update `AGENTS.md` (loop invariants), `README.md` (the `unverified` example and the clean rule), `docs/known-issues.md` (the workaround of "The verify skill marks a missing optional design as Not verified") and the loop-script coverage list in `docs/verification.md`. Verify by reading that none of them still presents a missing `design.md` as a reason for `unverified`.

## 2. Checks

- [x] 2.1 Run `npm run check`, then `git diff --exit-code -- dist/index.js`, and verify both succeed.
- [x] 2.2 Run `bb workflows validate --script "$(cat skills/openspec-verify-loop/verify-loop.js)" --json` and verify it reports `"valid": true`. Record the result in the `docs/verification.md` table.
