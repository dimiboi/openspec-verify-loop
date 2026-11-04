# Tasks

## 1. Quoted text

- [x] 1.1 In `skills/openspec-verify-loop/verify-loop.js`, add a helper that removes single-line `"…"` and `“…”` spans, and test `markedNotVerified` against its output in `isClean` and `isUnverified`; leave `nonzeroCount` on the full report. Allow a backtick between the colon or cell border and `Not verified` in `markedNotVerified`, so a status written as code is caught. Verify with 1.2, and confirm by reading that the script still uses only `agent`, `phase`, `log`, `args` and `budget`.
- [x] 1.2 In `tests/loop.test.ts`, add the quotation, backtick and quoted-count cases, the first using the sentence from run `wfr_edb86a01-afb7-4ee8-a659-83f82b698cca`, and verify `npx tsx --test tests/loop.test.ts` passes with the existing cases unchanged. Update the loop-script coverage list in `docs/verification.md`.

## 2. Final Assessment

- [x] 2.1 In `verify-loop.js`, add a helper that returns the text from the last Final Assessment heading (`###`, bold or plain, at a line start) to the end of the reply, and its count and `not verified` results; without a heading it returns the whole-report results from task 1.1. Use it in `isClean` and `isUnverified`. Verify with 2.2.
- [x] 2.2 In `tests/loop.test.ts`, add the scenarios of "Report text judged for clean and unverified": a body quoting the inputs from run `wfr_fc7b9c54-07c1-4a9b-9383-17671e929926` with an "All checks passed" Final Assessment ends `clean`; a skipped check named in the Final Assessment gives issues with `VERDICT: CLEAN` and `unverified` with `VERDICT: UNVERIFIED`; a count in the Final Assessment gives issues. Replay the five verifier reports from runs `wfr_cb7a6c94`, `wfr_edb86a01` and `wfr_fc7b9c54` by hand and confirm they give `unverified`, `clean`, `clean`, `clean`, `clean`. Verify `npx tsx --test tests/loop.test.ts` passes.
- [x] 2.3 Update the clean and unverified rules in `AGENTS.md` and `README.md`, and the loop-script coverage list in `docs/verification.md`. Verify by reading that they match the specs in this change.

## 3. Checks

- [x] 3.1 Run `npm run check`, then `git diff --exit-code -- dist/index.js`, and verify both succeed.
- [x] 3.2 Run `bb workflows validate --script "$(cat skills/openspec-verify-loop/verify-loop.js)" --json`, verify it reports `"valid": true`, and record the result in the `docs/verification.md` table, replacing this change's earlier row.
