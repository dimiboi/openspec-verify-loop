# Proposal

## Why

The audit reproduced OpenCode workers surviving a failed status request or an unsuccessful stop, including a stop that reports success while the completion notice says clean. It also found nested projects being moved to the Git root and emphasized warning counts being accepted as clean, so the loop can lose control of edits or report the wrong result.

## What Changes

- Keep an OpenCode worker's identity and cleanup operation until its termination is confirmed. On unconfirmed interruption, return failure, keep the checkout reserved, and let a later explicit stop retry cleanup without submitting another prompt.
- Apply the same cleanup rules to worker request failures, permission waits, stop, and unload. Make cancellation and completion produce one consistent outcome, and keep stop retry replies visible without duplicating the run's final notice.
- Keep checkout identity separate from the invoking working directory: reserve the canonical Git checkout, but discover project skills/models and run workers in the invoking project directory, including nested projects.
- Recognize nonzero severity counts with Markdown emphasis around the number or severity word in the shared script, while preserving Final Assessment selection and the existing quoted-status rules.
- Delete the unused `parseModel()` helper and its dedicated test.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-integration`: Define retained cleanup ownership, failed-stop retry and unload behavior, consistent cancellation reporting, and invoking-directory preservation under a checkout-wide reservation.
- `verification-loop`: Define emphasis-tolerant severity counts in the report text already selected for clean and unverified decisions.

## Impact

OpenCode changes touch `src/runner.ts`, `src/manager.ts`, `src/service.ts`, `src/opencode.ts`, `src/plugin.ts`, command reporting, path helpers as needed, and their fake-host tests. The count fix touches `skills/openspec-verify-loop/verify-loop.js` and `tests/loop.test.ts`; both hosts keep using that same script. Implementation regenerates `dist/index.js` and updates user and verification documentation.

No new dependencies, tool actions, or configuration are planned. Persistent locks, restart recovery, automatic cleanup retry loops, a full report parser, and additional bb controls remain out of scope. Existing OpenCode 2.2.5 prompt-reconciliation and server-identity workarounds remain in force; the plugin never manages the OpenCode service.
