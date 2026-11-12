# Design

## Context

See proposal.md for the decision on each finding. Only finding 1 needs code; findings 2–4 are documentation.

How the Pi report works today: `PiRuntime.agent()` commits a call record, admits the prompt, then blocks on `submission.wait()` until the worker answers. Durable run records (`PiRecords`) change only at those boundaries, and `publish()` copies them to `report.json`, which is the only thing `/opsx-verify-loop-report` reads (AGENTS.md: "On Pi, report reads only the atomic snapshot"). During one long response nothing is committed, so the report does not change.

Pi Durable 1.5.0 already streams the in-flight response into each conversation's live document (`LiveDoc`, exported from `@earendil-works/pi-durable`): `generation.message` holds a throttled partial, committed every `partialIntervalMs` (default 100 ms) as a deferred commit that observers see at once. Reasoning deltas (`reasoning_content` and similar fields) become thinking content in that partial, so a thinking-only response also advances it. Tool rounds and retry backoff appear there too. `Session.observeDoc(LiveDoc, conversationId, observer, ctx)` attaches a synchronous observer.

## Goals / Non-Goals

**Goals:**
- A Pi user can tell from `/opsx-verify-loop-report` whether the pending worker produced output recently.

**Non-Goals:**
- Token counts, partial text or a progress bar in the report.
- Automatic stall detection or timeouts (C25, C40).
- Changes on bb or OpenCode, whose worker threads and sessions already show live output.
- Live activity in the progress notices posted to the session.

## Decisions

**Activity source: observe the worker's `LiveDoc` while waiting.** In `agent()`, attach `observeDoc(LiveDoc, call.conversation, …)` before `submission.wait()` and dispose it in a `finally`. When the observer attaches, set `activity = {run, conversation, at: Date.now()}` and publish it, so a worker that never streams (a model stuck loading or in prompt processing, or a pending call reattached after resume, whose earlier `LiveDoc` changes predate the attach) still shows when waiting began. Each `advance` then moves `at` forward in memory. Alternatives: reading transcript entries or `harness.inspect()` does not move during one response (the observed case); probing the model server (`lms ps`, sockets) is host-specific and outside the plugin.

**Storage: snapshot only, not durable records.** `activity` is an optional top-level field of `report.json`, written by the existing `publish()` chain. Writing it to `PiRecords` would add a durable commit and a revision bump about every 100 ms of streaming. The snapshot version stays 1: the field is optional and current readers ignore it. Only one owner dispatches workers per checkout and calls are sequential, so one field suffices.

**Throttle: leading edge, 30 seconds.** On an `advance`, publish only if the last activity publication was at least 30 s earlier. The published time then lags the real last activity by under 30 s, without a timer. The observer must not call Session APIs synchronously, so it only records the time and calls `void this.publish().catch(() => {})`, whose snapshot read runs in a later microtask; a failed activity write must not become an unhandled rejection in the owner process.

**Clearing:** clear `activity` in the same `finally` that disposes the observer, so it is gone before any later publish: the one that saves a reply or failure, and also the one after a stop, where `coordinate()` returns early on the aborted signal and the last call keeps neither reply nor failure. An owner that exits while a call is pending still leaves its last published time, which is the correct "nothing since" answer: `closeOwned()` publishes `interrupted` before `harness.close()` aborts the worker, and nothing publishes after that.

**Rendering:** `PiService.report()` returns `snapshot.activity` alongside the run, and the report action passes it to `renderRun` when its run and conversation match the run's last call and that call has neither reply nor failure. The line reads `Last worker activity: <ISO time> (<n> s before this report)`. Notices pass none, so they are unchanged.

## Risks / Trade-offs

- [A provider extension that buffers reasoning and emits it only at the end would show no activity during thinking] → the live check in tasks.md repeats the Flint run setup through the same LM Studio extension and confirms, from the `pi-reports` evidence the live driver already records on each snapshot poll, that `activity.at` advances during the first verifier's final response. If it does not, record that in known-issues.md instead of adding a fallback.
- [Snapshot rewrites every 30 s copy the whole book, including earlier replies] → a few hundred kB at most per write, already the cost of every existing `publish()`.
- [A retry backoff counts as activity] → acceptable: the host is still acting on the call; the report already shows the worker as unfinished.
