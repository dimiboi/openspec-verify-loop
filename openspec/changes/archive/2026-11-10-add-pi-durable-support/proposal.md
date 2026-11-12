# Proposal

## Why

The verification loop currently installs on bb and OpenCode, leaving native Pi users without the same verify-and-fix workflow. Pi Durable can retain worker conversations and results across interruptions, allowing a user to resume an existing run explicitly instead of starting over.

## What Changes

- Add a native Pi extension with start, report, stop and resume commands, backed by `@earendil-works/pi-durable`.
- Run the existing `verify-loop.js` unchanged, with fresh sequential Durable conversations using the invoking session's model, thinking level, working directory and installed verify procedure.
- Persist run settings, worker identities, submissions, complete replies and results outside the checkout. Recover by replaying saved worker calls and reconnecting to unfinished work; never launch or resume merely because Pi loads or a report is viewed.
- Keep intentional stop terminal. Interrupt active execution before extension shutdown; retain interrupted runs for explicit resume. Refuse concurrent Pi ownership of one canonical checkout and retain cleanup failures for explicit recovery.
- Render progress and reports directly through Pi, without a reporting model turn.
- Extend deterministic package/adapter checks and opt-in live fixture testing to Pi, including interruption and explicit resume.
- **BREAKING:** Raise the package and development Node.js minimum from 22.18 to 22.19 to match the inspected Pi Durable runtime requirement. Keep existing bb and OpenCode interfaces and behavior.

## Capabilities

### New Capabilities

- `pi-integration`: Native Pi package entry, commands, worker configuration, durable call replay, explicit resume, checkout ownership, cleanup and reporting.

### Modified Capabilities

- `verification-loop`: Extend the single-script contract to Pi and distinguish resumable host interruption from a terminal worker failure without changing verdict or round decisions.
- `live-host-testing`: Add an opt-in Pi driver for fix-to-clean, stop and interruption/resume, preserving the existing fixture, independent assertions and evidence requirements.

## Impact

- New Pi implementation in `src/`, a separate generated Pi entry in `dist/`, and explicit Pi resource declarations in `package.json`; update bundle/package validation and dependency metadata without changing the OpenCode default export or bb entry.
- Pi Durable and Chord runtime dependencies, with an exact tested Durable version; Pi-supplied SDK packages remain external peer dependencies. Development and package metadata adopt Node.js >=22.19.
- New fake-host and durable-recovery tests, extensions to package tests and a separate `tests/live/pi.ts` driver using the greeting fixture.
- Update README, repository guidance and host-verification documentation. Existing OpenCode workarounds remain in place; this change does not add recovery to OpenCode, coordinate ownership across different hosts, create a daemon, sandbox worker shells, or promise exactly-once shell side effects.
