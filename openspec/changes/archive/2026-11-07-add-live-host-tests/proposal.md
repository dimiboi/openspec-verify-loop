# Proposal

## Why

Real-host checks currently depend on external sandbox repositories and disposable scripts. A recent run rebuilt OpenCode setup and inspection tools, missed completion because its watcher confused `outcome` with `status`, and required manual reconstruction of worker activity; preserving this machinery will make bb and OpenCode checks repeatable and easier to assess.

## What Changes

- Add explicit development commands for live bb and OpenCode tests, separate from the deterministic `npm run check` suite.
- Commit one small Git/OpenSpec greeting fixture with known defects, failing tests and no optional design document; prepare a fresh checkout for every scenario.
- Add small host drivers that exercise the installed bb skill or native OpenCode commands, observe fresh workers and reporting, and support fix-to-clean and active-worker stop scenarios.
- Check final greeting behavior independently of worker-editable tests, and save complete evidence with the tested revision, settings, host identities, assertions and cleanup results.
- Bound observation and cleanup, retain unsuccessful attempts, and never repeat a start to recover an uncertain response.
- Document setup and evidence review, including explicit bb installation and OpenCode's existing-service requirement. Keep native unload and injected-failure checks as manual diagnostics.

## Capabilities

### New Capabilities

- `live-host-testing`: Opt-in development tests that prepare isolated fixtures, exercise each host's public loop entry, independently assess results and retain evidence.

### Modified Capabilities

None. The verification loop, production prompts and host plugin contracts do not change.

## Impact

- Development additions under `tests/live/`, deterministic harness tests under the existing test glob, separate npm scripts, and updates to `docs/verification.md` and the README's development guidance.
- Reuse the existing Node runtime, bb CLI and pinned OpenCode client; add no production dependency or plugin testing option. Host SDK/runtime dependencies remain external to the bundle.
- Live execution requires an available chosen model, a supplied installed `openspec-verify-change` procedure, and the selected running host. It consumes model resources only through the explicit live commands.
- bb installation remains an explicit operator setup step because changing its plugin source affects other threads. OpenCode uses an isolated complete package snapshot and never starts, replaces, stops or globally reloads a service.
