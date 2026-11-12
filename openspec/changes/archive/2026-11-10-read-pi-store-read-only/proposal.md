# Proposal

## Why

The Pi report read `report.json`, an atomic snapshot that the owning process republished after every records commit, because in Pi Durable 1.5.0 opening JSONL storage ran recovery writes even for a read-only Harness ([earendil-works/pi#11939](https://github.com/earendil-works/pi/issues/11939)). The package now pins Pi, Pi Durable and Chord 1.5.1. Durable 1.5.1 adds `openNodeJsonlStorage(directory, context, {readOnly: true})`, which creates and writes nothing, skips torn lines and unconfirmed sidecar records in memory, and rejects commits. With it, the snapshot, its publication chain and the "explicit recovery refreshes the snapshot" path are workarounds that are no longer needed.

## What Changes

- Report opens the authoritative Durable store read-only, with a fresh handle on each call (a handle keeps the state committed when it opened), reads the records, and closes it. It needs no checkout ownership and writes nothing. `report.json`, its publication after each commit and the snapshot type are removed. Start, resume, stop, shutdown and cleanup still open storage writable under exclusive checkout ownership, unchanged.
- Pending worker activity comes from the store itself: while a run is running, the report shows when the store last committed. While a worker call is pending, only that worker commits, and Durable stores streamed output and tool output within about a second, so the time follows the worker's activity, or, before any, the time waiting began. The 30-second in-memory throttle and the worker `LiveDoc` observer are removed. `LiveDoc` has no timestamps, and a read-only handle cannot watch later commits, so neither the document nor an observer can supply a time. An interrupted run shows no activity time, since its last commit is the owner's shutdown, not worker activity.
- A read-only open that races the writer removing a reclaimed sidecar fails with `not_found` in Durable 1.5.1 (it retries only corruption errors). This was observed in the suite and in a standalone proof: 7 out of 2,709 opens during continuous commits. Report retries that error, up to 5 attempts. It is recorded in `docs/known-issues.md` and replaces the #11939 entry.
- Docs: AGENTS.md invariant, README, `docs/verification.md`, `docs/known-issues.md` and `docs/future-improvements.md` (C23) describe the read-only open.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pi-integration`: Durable run records, Checkout ownership and Pending worker activity in reports describe the read-only report and the store's commit time.
- `live-host-testing`: the Pi driver observes run records through the same read-only open while the host runs.

## Impact

- `src/pi-runtime.ts`: `readRecords()` replaces `readSnapshot()`; `publish()`, the activity observer and `PiSnapshot`/`PiActivity` are removed.
- `src/pi-service.ts`, `src/pi.ts`: report reads `readRecords()`; activity is a timestamp; opening no longer publishes.
- `tests/`: snapshot tests are replaced with read-only report tests; a new `tests/durable-readonly.test.ts` proves the read-only contract against the installed Durable 1.5.1, with a writer subprocess and no model.
- `tests/live/pi.ts`: observation uses `readRecords()`.
- No change to `verify-loop.js`, run record shapes, bb or OpenCode.
