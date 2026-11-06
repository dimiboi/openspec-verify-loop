# Design

## Context

See `proposal.md` for motivation and the two delta specs for observable behavior.
This design is needed because cleanup ownership spans the runner, manager,
adapter, commands and plugin unload path.

`createAgent()` currently keeps its assignment in a local variable and only
interrupts on cancellation or a permission wait. It discards negative
interruption confirmations and errors. `RunManager` owns only an abort signal
and execution promise, removes every settled run, and maps any error after an
abort to stopped. It therefore cannot retry cleanup after execution settles.
The plugin also caches its cleanup promise, including a rejection, and command
reply suppression assumes that a stop produced a terminal run notice.

`LoopService` uses the canonical Git root for both reservation and worker
context. The SDK exposes both a session location and an optional subpath;
worker validation currently compares only the raw location directory. The
loop's count matcher reads raw Markdown even though verdict reading already
tolerates formatting.

The audit reproduced lifecycle failures with fake adapters and directory loss
at the service boundary. Native host normalization of nested sessions and its
handling of a rejected plugin cleanup have not been manually verified.

## Goals / Non-Goals

**Goals:**

- Keep enough ownership information to stop a worker after loop execution has
  failed, with explicit cleanup retries and no prompt resubmission.
- Make stop, final result commitment and command replies agree at their race
  boundaries.
- Preserve nested project context without weakening the checkout-wide
  reservation or worker identity checks.
- Close the demonstrated severity-formatting gap in the shared script.

**Non-Goals:**

- Persist ownership across a process crash or host restart, coordinate separate
  plugin generations with disk locks, or implement the deferred ownership work
  in C26 of `docs/future-improvements.md`.
- Add automatic cleanup retry timers, a new status/action/configuration API,
  a Markdown dependency, or a full report parser.
- Change worker permissions, model inheritance, round control, or bb host
  orchestration.

## Decisions

### 1. Retain the active worker separately from execution settlement

Extend the existing in-memory run record with an optional worker cleanup
handle: its session identity and the operation that interrupts and confirms
that worker. The runner registers this handle before dispatch can admit work
and clears it only after a terminal observation or confirmed interruption.
Pass that registration through the existing service/execute boundary rather
than introducing a second worker registry.

The execution result and the retained worker handle have separate lifetimes.
A failed execution sends its terminal failure notice once, but its run entry
remains reserved while the handle exists. A later stop operates on that handle
even when the original execution promise has settled. Successful cleanup then
releases the reservation without changing or re-notifying the historical run
result.

Alternative: interrupt in a runner `finally` and always delete the run. That
would cover ordinary request failures but still abandon workers when cleanup
fails. Persistent ownership would solve a different, deferred crash case.

### 2. Use one cleanup operation with explicit failure

Runner error paths, permission waits, explicit stops and unload all use the
same retained cleanup handle. A successful terminal observation already proves
the worker is inactive; it does not require another interruption request.
Otherwise cleanup must confirm interruption. A false result or exception is a
failure, not a stopped worker. Preserve the original error or pending request
alongside the worker identity and cleanup failure in the result reason.

Do not remap cleanup failure to stopped just because the signal is aborted.
Reuse the existing `failed` outcome/status rather than adding a public status.
There are no automatic retries: a subsequent explicit stop retries once for
that invocation. Concurrent stop/unload callers share an in-flight cleanup
attempt so they cannot race to clear the same handle.

Keep cancellation of admitted inbox work and confirmation of idle state in the
adapter. Attempt the active-session interruption even if an inbox inspection
or cancellation fails, then require enough confirmation to release ownership.
An unresolved inbox error cannot be hidden as success. A session confirmed
missing is already inactive under the adapter's existing contract.

Alternative: wait and retry indefinitely. The user selected a visible failure
and retained reservation instead, so a disconnected host does not leave the
stop request silently pending.

### 3. Reconcile in-flight dispatch and commit cancellation consistently

Keep the OpenCode 2.2.5 admission workaround unchanged: submit once, reconcile
an uncertain result by input ID, and fail if it cannot be found. A stop must
not abandon an in-flight dispatch promise and allow its input to be admitted
after ownership has been released. Await/reconcile that admission before
declaring cleanup complete, without another submission.

Check cancellation after session creation before starting dispatch, after
observations, and before committing the terminal run result. Once a stop is
accepted while the run is still uncommitted, cancellation wins. If the final
observation proves the worker idle, clear the handle and commit stopped; if it
does not, confirm interruption first. A stop after result commitment and
reservation release returns not_running.

Alternative: check the signal only before polling, as today. That allows a
completed response received after stop to become a clean notice.

### 4. Separate terminal run notices from stop-operation replies

Keep one terminal notice per execution. A run with unconfirmed cleanup sends a
failed notice naming the worker and explaining that the checkout is reserved
and another stop retries cleanup. This notice is the initial same-session stop
reply when that invocation caused it, avoiding duplicate responses.

Record whether a stop invocation actually answered its caller through that
terminal notice. Suppress a command reply only in that case. A later cleanup
retry must return its own stopped/failed outcome to the caller, including the
starting session, without another terminal run notice. Stops from other
sessions still receive their own responses. Reporting turns remain tool-less.

Alternative: suppress every successful stop from the origin session. That
would hide successful retry results after the run's failed notice was already
sent.

### 5. Make plugin cleanup retryable without claiming successful unload

Manager close attempts both executing workers and handles retained after
execution failure. It succeeds only after all such workers are confirmed
inactive. On failure, propagate an error with the worker identity and keep
new starts refused; do not dispose loop controls first. Keep stop/retry replies
deliverable if unload fails, rather than leaving the notice suppression flag
permanently set.

Cache only an in-flight or successful plugin cleanup. A rejected attempt must
allow a later cleanup invocation to try the retained handles again. Once
cleanup succeeds, dispose registrations once, using the existing disposal
structure.

The plugin can reject its cleanup callback; it cannot force OpenCode to cancel
an unload if the host ignores that rejection. Manual verification must record
that host behavior. Do not replace or restart the service or add cross-reload
locking as a workaround in this change.

### 6. Keep checkout identity and effective directory separate

Resolve the invoking session's effective directory from its location and any
host-represented subpath, and canonicalize it. Derive the canonical Git checkout
root from that directory for the manager's key. Pass the effective directory
to catalogue lookup and worker assignments; never substitute the plugin's
location or the Git root for the invoking project context.

Validate a created worker's effective directory using the same location/subpath
interpretation, in addition to all existing model, permission and metadata
checks. This preserves validation when the host represents a requested nested
directory as a root location plus subpath. Confirm that round-trip with the
pinned SDK/host; test both representations with fake sessions.

Sibling directories and symlink aliases within a checkout share one canonical
reservation. A stop from a sibling resolves that reservation without changing
the retained worker's directory.

Alternative: reserve each working directory independently. That would permit
two loops to edit one checkout concurrently. Always using the Git root loses
the nearest OpenSpec project, which the audit demonstrated.

### 7. Normalize only the severity-count input

Select the report text exactly as today, then remove simple emphasis/code
marks for the severity-count scan. The same positive count must be recognized
whether its number or severity word uses asterisks, underscores or backticks.
Keep the existing positive-integer count grammar; zero counts remain zero.
Leave `Not verified` matching, quote handling, heading selection and returned
report text unchanged.

Implement this only in `skills/openspec-verify-loop/verify-loop.js`. Both hosts
continue loading that script unchanged. A general report/Markdown parser would
expand the contract beyond the demonstrated formatting gap.

### 8. Remove the unused model-string path

Delete `parseModel()`, its test import and its dedicated test. Searches found
no production caller, and model resolution already uses host-provided model
objects. No replacement helper or public behavior requirement is needed.

## Risks / Trade-offs

- **A host remains unreachable:** the checkout stays reserved until explicit
  cleanup succeeds. Report the worker session and retry instruction instead
  of allowing overlapping edits.
- **OpenCode ignores a rejected unload callback:** the plugin cannot guarantee
  ownership across the host-forced unload. Record the manual result and any
  upstream limitation in `docs/known-issues.md`; persistent ownership remains
  outside this change.
- **Native nested-directory representation differs from fake sessions:**
  confirm the location/subpath round-trip manually and keep a fixture matching
  the observed representation. The acceptance criterion remains the invoking
  effective directory, regardless of its transport representation.
- **A formatting fix reintroduces quoted-status false positives:** normalize
  only the count scan and retain the existing quoted-status and Final
  Assessment regression cases.
- **Synthetic audit probes are mistaken for live-host evidence:** automated
  coverage uses only fake hosts/models. Record manual checks separately with
  date, host version, run and outcome; never treat old stop records as proof
  of these changed lifecycle paths.

## Migration Plan

There is no persisted run-state migration or new configuration. After
implementation, regenerate the committed `dist/index.js`, run `npm run check`,
and validate the exact shared script with bb's workflow validator without
starting a workflow. Update README/skill guidance for failed cleanup and
explicit retry, and extend `docs/verification.md` with the new deterministic
coverage and separate manual checks.

Apply the updated plugin through the normal host plugin lifecycle. Rolling
back restores the prior package and its prior cleanup limitations; never
clear a retained reservation merely to install or roll back while its worker
may still be editing. The plugin must not manage the OpenCode service.
