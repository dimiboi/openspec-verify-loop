# Tasks

## 1. Read-only report

- [x] 1.1 In `src/pi-runtime.ts`, add `readRecords(directory)`: return no runs when `store/main.jsonl` is missing; otherwise take its mtime, open the store with `openNodeJsonlStorage(…, {readOnly: true})` and a `readOnly` Harness, read `PiRecords`, close, and return the records with `committed`. Retry only a `not_found` open failure, up to 5 attempts. Remove `readSnapshot`, `PiSnapshot`, `PiActivity`, `publish()` and the `LiveDoc` activity observer.
- [x] 1.2 In `src/pi-service.ts`, make `report()` use `readRecords()` and set `activity` to `committed` only while the run is `running` with a live owner; drop the publication on open and the snapshot comment on resume. In `src/pi.ts`, render a numeric activity time for a pending last call.
- [x] 1.3 Keep writable opens (start, resume, stop, cleanup) under exclusive ownership, unchanged.

## 2. Tests

- [x] 2.1 Replace snapshot reads in `tests/pi-runtime.test.ts` with `readRecords()`, keeping the check that reading leaves `main.jsonl` unchanged.
- [x] 2.2 In `tests/pi-service.test.ts`: activity from the store commit time (a silent worker keeps the waiting time, streamed output moves it without a records revision, cleared after reply and stop, none after the owner exits); report over a torn store tail changes no byte or mtime and a report in a checkout without state creates no directory; an opening failure releases ownership.
- [x] 2.3 Make the live-driver fake in `tests/live-pi.test.ts` write a real Durable store, and switch `tests/live/pi.ts` observation to `readRecords()`.
- [x] 2.4 Add `tests/durable-readonly.test.ts` against the installed Durable 1.5.1, with no model: torn tail plus unconfirmed sidecar record leave bytes and mtimes unchanged (a writable open is the control); a missing directory is not created; a held handle keeps its open state while fresh opens beside a writer subprocess see newer commits and the last one after it exits; `readRecords()` survives the listing race.
- [x] 2.5 Run `npm run bundle` and `npm run check` with the same npm cache as `npm ci`.

## 3. Docs

- [x] 3.1 Update the AGENTS.md Pi report invariant, README Pi section, `docs/verification.md` (not dated runs), `docs/future-improvements.md` C23, and replace the #11939 entry in `docs/known-issues.md` with the listing-race entry.
- [x] 3.2 Sync the `pi-integration` and `live-host-testing` deltas into `openspec/specs/`.

## 4. Manual (maintainer)

- [x] 4.1 Live Pi run: during a long verifier response, `/opsx-verify-loop-report` shows a last-activity time a few seconds behind the stream; the driver's read-only observation never fails and never changes `store/`. Then archive this change.
