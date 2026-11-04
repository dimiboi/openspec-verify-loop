# Proposal

## Why

Most small changes rightly have no `design.md`, which OpenSpec treats as
optional, yet the `openspec-verify-change` skill marks Design Adherence
`Not verified` whenever it is absent. Every such change therefore ends
`unverified` instead of `clean`, even when the verifier found nothing, as in
run `wfr_cb7a6c94-f2db-485f-a220-5b2063151de3` on
`block-unrecognized-verdicts`. Users then have to read the report to learn that
nothing is wrong.

## What Changes

- Verifier prompts tell the verifier that a change without `design.md` has
  omitted an optional document, so Design Adherence is **Not applicable**, not
  `Not verified`. A change with no other gaps and no issues can then end
  `clean`.
- Fixer prompts are unchanged: fixers still never create `design.md` or other
  optional artifacts to satisfy a check.
- The loop's routing does not change. `unverified` remains for other checks
  that could not run, such as tests whose dependencies are missing.
- **BREAKING**: a change that needed a design but has none no longer surfaces
  as `unverified`; the loop accepts that risk.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-loop`: a new verifier-prompt rule for an absent optional
  design, and an `unverified` example that no longer relies on a missing
  `design.md`.

## Impact

- `skills/openspec-verify-loop/verify-loop.js`: one verifier-prompt line. Both
  hosts run it.
- `tests/loop.test.ts`: the prompt assertion and the `unverified` example.
- `AGENTS.md`, `README.md`, `docs/known-issues.md`, `docs/verification.md`: the
  rule, the `unverified` description and example, the known-issue workaround,
  and the test coverage and validation records.
- No routing, host adapter, dependency or API change.
