# Proposal

## Why

Verifier prompts forbid creating any file, but also require the real exit
code of every command without truncated output. Saving full output to a
temporary file is the natural way to meet the second rule, so verifiers break
the first: run `wfr_9f0891b5-e7cb-4bb8-838c-0af6ad226d77` wrote
`/tmp/verify-tests.out`, and an earlier run wrote `/tmp/t.log`. Neither touched
the checkout, which is what the rule exists to protect.

## What Changes

- The verifier no-edit rule covers the checkout only: verifiers may create
  temporary files outside it, such as under `$TMPDIR` or `/tmp`.
- Verifiers still must not edit, create or delete files in the checkout,
  including through the shell.
- On OpenCode, verifiers stay denied the edit tool; temporary files come from
  shell commands, as in the observed runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-loop`: the "Worker rules" requirement limits the verifier
  no-edit rule to the checkout and allows temporary files outside it.

## Impact

- `skills/openspec-verify-loop/verify-loop.js`: one verifier-prompt line.
- `tests/loop.test.ts`: the worker-rules assertions.
- `README.md`, `docs/verification.md`: the worker rules and a validation
  record.
