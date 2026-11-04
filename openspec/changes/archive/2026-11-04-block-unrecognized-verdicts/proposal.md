# Proposal

## Why

The loop sends every verifier reply it cannot classify to a fixer. That includes
the bare `VERDICT: BLOCKED` that its own prompt asks for when several changes
are active, because the parser requires a reason after `BLOCKED`. The ambiguous
case therefore ends `blocked` only by accident, with the wrong reason, or as
`limit` with `--max-rounds 1`, or with a fixer working on a change name read
from a made-up title. Empty, truncated and verdict-less replies, and
near-misses such as `VERDICT: CLEAN.`, also reach a fixer told to fix every
issue in a report that may have none.

## What Changes

- The verdict line is read tolerantly: emphasis marks at its edges and a
  trailing period no longer hide a verdict.
- `VERDICT: BLOCKED` is recognised with or without a reason, and with a colon
  or dash after `BLOCKED`, for both verifiers and fixers.
- A verifier reply whose last line is not one of the four verdicts ends the run
  `blocked` with an "unrecognized verifier result" reason, before the round
  limit and before a fixer. **BREAKING** for runs that today continue through a
  fixer on such a reply.
- A fixer now runs only for `VERDICT: ISSUES` or for a `VERDICT: CLEAN` or
  `VERDICT: UNVERIFIED` that the report contradicts. Contradicted verdicts
  still count as issues.

Out of scope: requiring exactly one `VERDICT:` line, case-insensitive verdicts,
re-verifying after an unrecognized reply, and changes to the prompts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-loop`: how the verdict line is read; the blocked stop accepts
  a missing reason and other separators; an unrecognized verdict ends
  `blocked`; the fixer starts only on issues or a contradicted verdict.

## Impact

- `skills/openspec-verify-loop/verify-loop.js`: verdict-line normalisation, the
  blocked pattern, and one branch for unrecognized verdicts. Both hosts run it,
  so bb and OpenCode change together.
- `tests/loop.test.ts`: new routing cases.
- `README.md` and `docs/verification.md`: the `blocked` description, the suite
  coverage, and a new workflow-validation record.
- No dependency, API, tool or host adapter change.
