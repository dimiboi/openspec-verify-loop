# Proposal

## Why

The monitored Pi/Flint run of 2026-11-10 ([notes](../../../docs/pi-flint-live-2026-11-10.md)) passed but recorded four follow-ups. Two have observed triggers and need a change now: a Pi user cannot tell a worker that is still generating from a stalled one without host-level tools, and `npm run check` can fail depending on which npm cache `npm ci` filled. The other two have no trigger yet, so per AGENTS.md they are recorded, not built.

## What Changes

Decision per finding:

1. **Busy vs stalled worker (build, Pi only).** The Pi report stayed at revision 4 for 13 minutes while the verifier generated a 605-second response; telling progress from a hang needed `lms ps`, the LM Studio log and the worker's sockets. While a worker call is pending, the owning process will record when that worker's conversation last showed activity, taken from Pi Durable's per-conversation live state, or, before any, when waiting for it began, and publish it to the report snapshot at most every 30 seconds. `/opsx-verify-loop-report` shows it for the unfinished call. Nothing is added to durable run records, no extra notice is posted and no model turn runs. bb and OpenCode are unchanged: their worker threads and sessions already show live output natively. The notes' claim of an earlier Qwen trigger links to run notes that were never committed and is not backed by the Qwen rows in `docs/verification.md`, so it is dropped: this Flint observation alone is the trigger.
2. **Leaked tool-call markup (no code change).** Only a fixer reply was affected, fixer replies are only read for `VERDICT: BLOCKED`, and on a verifier the existing unrecognized-verdict rule already ends the run `blocked`, never a false `clean`. Stripping markup in `lastLine` waits for its trigger, so it is added to `docs/future-improvements.md` with the trigger "a verifier's reply ends with leaked tool-call markup after its verdict line". The fixer's unrequested verdict line is harmless and needs no rule.
3. **Very long medium-thinking responses (no change).** This is model behavior, not a loop defect; the run finished well inside its deadline, so the C25 trigger ("runs stall in ways the round limit does not catch") is not met. The run notes already record it as evidence for C25.
4. **`npm run check` depends on the npm cache (document).** The offline snapshot test installs production dependencies with `npm_config_offline=true` from whatever cache the environment selects. npm keeps no record of which cache filled `node_modules`, so the test cannot find it. The development instructions in AGENTS.md, README and `docs/verification.md` will say that `npm ci` and `npm run check` must use the same npm cache, and name `ENOTCACHED` as the symptom.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pi-integration`: reports show the pending worker's last activity time. The capability is introduced by the unarchived `add-pi-durable-support` change, which must be archived first; the delta only adds a requirement, so it applies on top of it.

## Impact

- `src/pi-runtime.ts`: observe the pending worker conversation's live document while waiting for its submission; keep the last activity time in memory; add it to the published snapshot, throttled.
- `src/pi-service.ts`: `report()` returns the snapshot's activity with the run.
- `src/pi.ts`: render the activity line for the unfinished call; `dist/pi.js` regenerated.
- `tests/pi-service.test.ts`: one deterministic check with a fake streaming provider.
- Docs: `README.md` (activity line by the Pi report command; npm cache), `AGENTS.md`, `docs/verification.md` (npm cache), `docs/future-improvements.md` (markup entry), `docs/pi-flint-live-2026-11-10.md` (drop the unsupported Qwen trigger and its broken link).
- No change to `verify-loop.js`, the snapshot version, durable record shapes, bb or OpenCode.
