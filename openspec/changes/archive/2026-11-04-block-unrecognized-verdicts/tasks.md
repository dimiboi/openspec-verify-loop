# Tasks

## 1. Verdict routing

- [x] 1.1 In `skills/openspec-verify-loop/verify-loop.js`, read the last non-empty line with `` ` `` and `*` removed as now, plus `_` stripped only at the line's edges and one trailing period dropped. Verify with the emphasis, period and underscore-reason cases in 1.4.
- [x] 1.2 Replace the blocked pattern with one that accepts `VERDICT: BLOCKED` alone or followed by optional whitespace, a colon or dash (`-`, en dash, em dash) and a reason, returning "no reason given" when the reason is empty. Use it for verifier and fixer replies. Verify with the bare, colon and reason cases in 1.4.
- [x] 1.3 After the blocked check and before the change-title parse and the round limit, end the run `blocked` with an "Unrecognized verifier result" reason and the reply as `report` when the verifier's line is not `VERDICT: CLEAN`, `VERDICT: UNVERIFIED` or `VERDICT: ISSUES`. Leave contradicted CLEAN and UNVERIFIED verdicts going to the fixer. Verify with 1.4, and confirm by reading that the script still uses only `agent`, `phase`, `log`, `args` and `budget`.
- [x] 1.4 Extend `tests/loop.test.ts` and verify `npx tsx --test tests/loop.test.ts` passes these cases (existing cases unchanged):
  - `VERDICT: BLOCKED: requirement conflict` from a verifier and from a fixer gives `blocked` with reason `requirement conflict`;
  - with no change given, a reply listing changes and ending with a bare `VERDICT: BLOCKED` gives `blocked`, a no-reason reason and that report, also with `maxRounds` 1;
  - `VERDICT: BLOCKED missing PAYMENTS_API_KEY` keeps the underscores in the reason;
  - `**VERDICT: CLEAN**`, `_VERDICT: CLEAN_` and `VERDICT: CLEAN.` on a clean report give `clean`;
  - an empty reply, a report ending `Verdict: issues`, and a report with no verdict line give `blocked` with no fixer, also on the last round;
  - a fixer reply with no verdict line leads to the next verification.
- [x] 1.5 Update `README.md`: the `blocked` status also covers a verifier reply without a recognized verdict line. Update the loop-script coverage list in `docs/verification.md` with the new cases. Verify by reading that both match the specs in this change.

## 2. Checks

- [x] 2.1 Run `npm run check`, then `git diff --exit-code -- dist/index.js`, and verify both succeed. The bundle should not change, since the script is read from the skill directory at run time.
- [x] 2.2 Run `bb workflows validate --script "$(cat skills/openspec-verify-loop/verify-loop.js)"` (manual; needs the bb CLI) and verify it reports `"valid": true`, including with the dash characters in the new pattern. Record the result in the `docs/verification.md` table.
