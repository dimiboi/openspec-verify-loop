# Tasks

## 1. OpenCode start and connection failures

- [x] 1.1 Add fake-host tests for a start outside a Git checkout (blocked, Git checkout message), tool input with an unknown field or a field its action does not accept (rejected, no session created), no discoverable OpenCode service (blocked, names the `server` option) and a catalogue whose server reports another version (blocked, names both versions). Verify with `npm test`.
- [x] 1.2 Describe the new start and connection coverage in the Plugin and Project context entries of docs/verification.md. Verify the wording matches the tests from 1.1.

## 2. Worker session, submission and outcome failures

- [x] 2.1 Add adapter tests for a lost creation response reconciled without a second session, a creation failure with no session (fails with the creation error, no prompt), unexpected input or mismatched input text before submission (fails, no prompt), a repeated message cursor and a transcript above 20,000 messages (both fail), and an interrupted worker outcome (fails as interrupted). Verify with `npm test`.
- [x] 2.2 Describe the new worker coverage in the Runner and Plugin entries of docs/verification.md. Verify the wording matches the tests from 2.1 and the existing read-before-submission and submission-error tests.

## 3. bb skill failures

- [x] 3.1 Add to skills/openspec-verify-loop/SKILL.md that a failed `bb workflows run` is reported and never retried or replaced by another start, and have scripts/validate-plugin.mjs check that the skill states both the missing-verify-skill stop and the no-retry rule. Verify with `node scripts/validate-plugin.mjs`.

## 4. Integration

- [x] 4.1 Run `npm run check` and `openspec validate specify-failure-paths --strict`; both pass and `dist/index.js` is unchanged.

## Workflow follow-up

- Sync the delta specs and archive the change once verified.
