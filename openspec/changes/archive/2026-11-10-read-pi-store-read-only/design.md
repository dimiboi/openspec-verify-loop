# Design

## Context

Before this change, the owning Pi process committed run records to a Durable JSONL store and, after every commit, copied them to `report.json`. Report read only that copy, because Durable 1.5.0's JSONL opener repaired files on open even under a read-only Harness (#11939). Worker activity was observed through the pending conversation's `LiveDoc` and published into the same copy at most every 30 s.

Durable 1.5.1 adds `{readOnly: true}` to `openNodeJsonlStorage`. Such an open creates and writes nothing, skips torn lines and unconfirmed sidecar records in memory, holds the state committed at open, and rejects `commit()`. `HarnessOptions.readOnly` still does not reach the storage open, so both flags are needed.

## Decisions

**Report opens a fresh read-only handle per call.** `readRecords(directory)` opens the store with `{readOnly: true}` and the Harness with `readOnly: true`, an empty registry and no models (nothing is scheduled), reads `PiRecords`, and closes both. A handle holds the state committed when it opened, so caching one would show stale records. A missing store returns no runs without opening anything: a read-only open of a missing directory fails, and this keeps the existing "No unfinished loop" message.

**Activity: the store's last commit time.** Every Durable commit appends a marker to `main.jsonl`, and deferred progress (partial answers, tool output) is stored within `persistWithinMs` (default 1 s). While a call is pending, the coordinator only waits, the scheduler commits nothing on a timer, and calls are sequential, so the commit time of `main.jsonl` follows the worker: its last streamed or tool output, or the admission commit when waiting began. Report stats the file before opening, so the time is never newer than the state it shows. The time is shown only while the run is `running` with a live owner: after shutdown the last commit is the owner's `interrupted` commit, not worker activity.

Alternatives considered:
- *Read the worker's `LiveDoc` from the read-only Harness.* `LiveState` has no timestamps; it says what the worker is doing, not when it last did it.
- *Observe `LiveDoc` from the reporter.* A read-only handle holds the state at open, so an observer sees no later commits, and report is one-shot anyway.
- *Keep a small activity sidecar written by the owner.* It works, but it is the snapshot again in a smaller form, and the store already records the time.

**Retry the listing race.** Durable 1.5.1 retries a read-only open only for corruption errors while `main.jsonl` changed. A directory listing that sees `doc-N.jsonl.reclaim` and then fails to stat it, because the writer removed it, rejects with a `not_found` cause. This was observed in the suite and in the standalone proof. Report retries that error up to 5 attempts and rethrows anything else.

**Writers unchanged.** Start, resume, stop and cleanup acquire ownership before the writable open, as before. Removing the snapshot removes `PiRuntime.publish()` and the publication on open, so an opening failure now has only the ownership to release.

## Risks / Trade-offs

- Each report reads the whole JSONL history into memory, which the owner already does. Report cost grows with the store; there is no retention cleanup.
- A file-system time is only as precise as the file system's mtime (nanoseconds on APFS and ext4).
