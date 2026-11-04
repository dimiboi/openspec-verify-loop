# Proposal

## Why

The `verification-loop` "Worker rules" requirement states two behaviors: the
rules every worker prompt carries, and the verifier-only checkout rule. With
the no-loop rule from `hide-loop-skill-from-bb-workers`, its description is 586
characters. `openspec validate --specs --strict` fails on descriptions over
500, so the main specs no longer pass strict validation.

## What Changes

- "Worker rules" keeps only the rules every worker prompt carries, with its
  header and both scenarios unchanged.
- The verifier-only sentence becomes its own requirement, "Verifier checkout
  edits", with scenarios for the verifier and fixer prompts. Its meaning is
  unchanged.
- No prompt, code, test or user-facing behavior changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-loop`: "Worker rules" drops the verifier-only sentence, which
  moves unchanged into a new requirement, "Verifier checkout edits".

## Impact

- `openspec/specs/verification-loop/spec.md` after sync; `openspec validate
  --specs --strict` passes again.
- No source, test or documentation changes: `tests/loop.test.ts` already
  asserts both requirements, and the docs describe the rules, not the
  requirement layout.
