# Tasks

## 1. Spec split

- [x] 1.1 Confirm that the delta's "Worker rules" keeps its header, all four bullets and both scenarios unchanged, and that "Verifier checkout edits" carries the removed sentence's meaning. Verify by diffing the delta against `openspec/specs/verification-loop/spec.md`.
- [x] 1.2 Confirm that `tests/loop.test.ts` already covers both requirements: the worker-rules test asserts the shared rules in every prompt and the checkout no-edit rule with its temporary-file allowance only in verifier prompts. Verify `npx tsx --test tests/loop.test.ts` passes.
- [x] 1.3 Run `openspec validate split-worker-rules --strict` and verify it passes.

## Workflow follow-up

- Sync the specs, then verify `openspec validate --specs --strict` passes for every spec.
- Archive the change.
