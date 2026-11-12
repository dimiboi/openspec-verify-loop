# Design

## Context

See [proposal.md](proposal.md) for motivation and scope. `src/loop.ts` already loads the packaged script relative to `import.meta.url` and evaluates it with the five host globals. `src/service.ts` and `src/runner.ts` supply OpenCode-specific discovery and workers; `src/manager.ts` owns in-memory OpenCode runs and notices. Those classes are not a durable, host-neutral service, so Pi should reuse the script runner without refactoring the OpenCode lifecycle.

The current package builds only `dist/index.js`, exposes the bb entry separately and ships a bb-specific skill. The live harness has a reusable greeting fixture, independent assertions and evidence helpers, but its host/options types currently admit only bb and OpenCode.

The upstream API inspected for this plan is Pi commit `7d073328e44337d3292a7db9b0f0308f679c5e97` (2026-11-08). Its Durable package manifest declares version 1.5.0 and Node >=22.19. The public API is experimental. These observations identify the planning baseline, not a completed compatibility test:

- [Durable README](https://github.com/earendil-works/pi/blob/7d073328e44337d3292a7db9b0f0308f679c5e97/packages/durable/README.md): stored conversations and submissions, durable tasks, explicit scheduler resume, ownership and cancellation; one writer process per storage with no cross-process lock.
- [Pi extensions](https://github.com/earendil-works/pi/blob/7d073328e44337d3292a7db9b0f0308f679c5e97/packages/coding-agent/docs/extensions.md): native commands, current model/thinking, provider/auth resolution, skill-command provenance, lifecycle events and native message rendering.
- [Pi packages](https://github.com/earendil-works/pi/blob/7d073328e44337d3292a7db9b0f0308f679c5e97/packages/coding-agent/docs/packages.md): explicit resource declarations and host-supplied SDK peer dependencies.

## Goals / Non-Goals

**Goals:** Keep one loop definition; persist the relationship between each loop call and its worker; make restart behavior inert until explicit resume; establish exclusive checkout ownership before scheduling; preserve cleanup evidence and full reports.

**Non-Goals:** A daemon, a general workflow engine, automatic continuation, a second loop state machine, arbitrary inherited Pi extensions/tools, cross-host locking, OpenCode recovery, shell sandboxing or exactly-once filesystem/process effects.

## Decisions

### 1. Add an isolated Pi entry and a small host adapter

Implement the extension under `src/` with a separate generated `dist/pi.js` entry. Keep `dist/index.js` as the OpenCode export and `bb/server.ts` as the bb entry. Set the package's Pi extension list explicitly and its Pi skill list to empty: the shared skill currently invokes bb Workflows, while Pi starts through native commands.

Keep host SDK/runtime imports external in both bundles. Declare Pi-supplied packages as optional host peers so an OpenCode or bb installation does not install a second Pi SDK. Declare the exact tested Pi Durable and required Chord runtime versions as runtime dependencies. Raise the package/development Node floor to 22.19, with release notes; do not silently install an unsupported runtime. Prefer the inspected 1.5.0 API, verifying the installed release before relying on it. Unsupported Pi/Durable combinations fail with an actionable compatibility error.

Alternative: use the coding-agent SDK's normal sessions alone. That would require building worker persistence and recovery independently despite the user's request to use Pi Durable. Alternative: generalize OpenCode's manager first. Its in-memory ownership and queued synthetic notices are different contracts and do not reduce this change.

### 2. Resolve settings from the invoking Pi session

Start captures `ctx.model`, effective thinking level, `ctx.cwd`, origin session identity, canonical Git checkout root, and one `skill:openspec-verify-change` catalogue entry with its source path. Validate inputs before worker creation. Use the current directory for OpenSpec discovery and workers; use the canonical checkout for ownership. Omitted change selection remains in the shared verifier prompt.

Build Durable's model access through the public Pi provider/model registry, including request-time authentication, configured headers and endpoints. Never read a private runtime field, fall back to environment-only credentials, or silently substitute a model. Test a custom provider and credential refresh, as well as standard providers; reject configurations that cannot be represented faithfully. Resolve fresh credentials on resume, without storing their values. Save the verify procedure's path and content hash.

Use Pi's public `loadProjectContextFiles` helper to supply the relevant project instructions to worker prompt sections; select only the needed coding tools and the verify procedure rather than inheriting the parent transcript or full extension registry. Role instructions come from the shared script. Worker-owned temporary files remain allowed outside the checkout.

### 3. Persist one checkout store and ordered call records

Use Durable's Node JSONL storage under Pi's agent state directory, namespaced by a hash of the canonical checkout path. Store outside the working tree so verifier activity does not dirty it. JSONL avoids a native SQLite dependency and is sufficient for a small sequential loop. Keep terminal runs for report; add no retention policy in this change. Alongside the authoritative store, atomically replace a report snapshot after acknowledged commits. Viewers read only this snapshot: Durable 1.5.0's JSONL opener performs recovery writes before Harness `readOnly` applies, so opening the live store is not a read-only operation. The snapshot records its source revision and can lag a crash; the next explicit recovery, under exclusive ownership, refreshes it from the authoritative state.

One control conversation stores per-run documents and owns one custom coordinator task for the unfinished run. The coordinator owns each fresh worker conversation through Durable task ownership. It executes `runScript()` in its run phase. Its saved state is a journal of effects, not another representation of loop branches:

| Record | Saved content |
| --- | --- |
| Run | ID, record version, checkout, invoking directory, origin, arguments, fixed call budget, model/thinking, procedure identity, loop hash, lifecycle state, coordinator task ID, result |
| Worker call | Position, phase/role, label, exact prompt, conversation ID, submission ID/request ID, admission state, full completed reply or failure |
| Cleanup | Outstanding worker/execution identities, confirmation state and error when cleanup cannot be established |

Persist creation and its call record together. Admit the prompt and persist its submission receipt in the same storage commit, before work can outlive its identity. If admission returns uncertainly, query that identity; do not submit again. If correlation cannot be established, stop execution and retain known cleanup information.

### 4. Replay only the deterministic coordinator

On each coordinator invocation, start the unchanged script from the top with the saved arguments and budget. Its `agent()` adapter numbers calls locally and compares each call to the corresponding saved prompt and role:

1. A completed call returns its exact saved reply without any model work.
2. A pending admitted call reacquires its conversation/submission by identity and waits for that same work.
3. A genuinely new call creates one fresh conversation, submits once, then saves the complete reply before returning it to the script.
4. A failed call, uncorrelated admission or mismatch prevents further dispatch.

The script derives the selected change, round count, verdict and next prompt again from the same replies. The adapter records progress but makes no such decisions. Save a fixed `maxAgentCalls` value, following the existing non-bb adapter's effectively unbounded budget, so resume cannot increase the original `maxRounds` allowance.

Check loop hash, adapter record version, procedure identity, checkout/directory and model/thinking availability before starting the scheduler. Use a versioned coordinator task so an incompatible adapter update cannot run an old task accidentally. Refuse incompatible recovery while preserving report and cleanup access; no migration engine is needed for a first version.

Alternative: persist separate verify/fix phases containing verdict branches. That would duplicate the script. Alternative: rely only on Durable transcripts. That cannot recover the coordinator's instruction pointer or identify which replies it already consumed.

### 5. Keep explicit resume separate from stop and shutdown

Expose the four commands specified in `pi-integration`; start/resume return after the run is admitted. With an omitted run ID, start-independent controls select the unique unfinished run; report falls back to the most recent terminal run. Refuse cross-checkout IDs and ambiguity.

The lifecycle is:

```text
start --> running --> clean | unverified | blocked | limit | failed
              |
        host closes/crashes
              v
         interrupted --explicit resume--> running
              |
         explicit stop
              v
           stopped
```

An explicit stop from running also ends stopped after confirmed cleanup. Cleanup uncertainty is retained alongside the lifecycle and prevents release or scheduling. Worker outcomes that actually settle failed/aborted stay terminal; an interrupted pending Durable task is recoverable. A crash after terminal commit but before display is reported as completed rather than rerun.

Opening the extension performs no scheduler resume or wait that can schedule work. Reports read the atomic snapshot and never open the authoritative store. A missing or unreadable snapshot is reported explicitly; report does not repair it or schedule work. Start refuses an existing unfinished run. Resume opens writable storage only after ownership, compatibility and previous-execution checks, and then starts the coordinator/scheduler. A second resume of a running run is refused.

On normal `session_shutdown` (quit, reload or replacement), fence further dispatch, save suspension intent, and close the harness, awaiting cancellation of active task code and execution environments. Durable close suspends work; it is not a user abort. Do not translate closure-related wait errors into a terminal run failure. The new extension remains inert.

Intentional stop persists stop intent and marks the coordinator task aborted before enabling cleanup scheduling; using a convenience method that resumes the scheduler before marking ownership aborted could execute saved work. Await abort completion and environment cleanup before committing stopped or releasing ownership. A stop retry cleans the retained identities; it never creates a worker. Serialize the terminal-result commit with stop intent so a previously accepted stop cannot report clean.

### 6. Establish ownership and reconcile process effects

Acquire a checkout-wide local process lock before writable storage. Use atomic acquisition/release with an owner token and process identity; never declare a lock stale solely because time passed. Keep one unfinished-run reservation in the store. A live competing process is refused, including through sibling directories and symlink aliases. Reports read the separately published snapshot without taking over the writer or invoking storage recovery.

Owner death alone does not prove its shell children stopped. The Node execution adapter must retain sufficient command/process identity and supervise cleanup of its owned processes. Recovery checks those identities before enabling generation or tool execution. If it cannot establish inactivity, refuse resume and retain actionable worker/process information for manual cleanup or a later stop retry. Do not treat restoration of consistent storage as proof that an external command did not run.

Use Durable's default unsafe replay treatment for coding tools with external effects. Never mark shell, write or edit operations replay-safe to obtain recovery: a crash can leave partial edits, and the recovered model must see interrupted tool outcomes and inspect current files. Test the actual Node execution environment's process shutdown behavior before claiming hard-crash recovery. Any needed execution supervision belongs in this Pi adapter, not in shared loop logic.

This protects simultaneous Pi owners only. bb/OpenCode retain their current ownership models; a global cross-host lock protocol would expand this change.

### 7. Render reports without a reporting model

Use native custom messages/entry renderers for progress and completion, without `triggerTurn`. Store the authoritative result before display. Include state, run/change identity, verification count and reason, with complete ordered worker replies available through report rendering or linked artifacts in the state directory. A stale origin session never receives a model follow-up; another session in the checkout can retrieve the record.

This avoids reproducing OpenCode's synthetic reporting-turn protection and pending-notice retry machinery. Repeated report requests only render stored data and cannot start another loop.

### 8. Extend tests through existing boundaries

Add fake Pi/model adapters and actual local-storage tests with fake generation, using the existing script cases for verdict/round behavior. Exercise atomic admission boundaries, replay after each completed/pending call, model/auth inheritance, inert inspection, compatibility refusal, two owners, stop races, shutdown suspension and cleanup retry. Tests may create local subprocesses to verify execution cleanup but must call no models and start no real Pi/OpenCode agent sessions.

Add `tests/live/pi.ts` and an opt-in npm command. Reuse the greeting fixture, independent behavior checks, provenance and retained evidence in `tests/live/common.ts`; extend host/scenario options only where Pi needs them. Use a fixture-scoped Pi RPC process and native extension commands, not private calls that bypass discovery. `resume` observes a completed call plus an unfinished one, interrupts the owned host, restarts and reports without work, then explicitly resumes the same run. Retain Pi/Durable versions, run/worker/submission identities, settings, reports, final diff and cleanup outcome. A missed interruption is an unsuccessful attempt, not a reason to launch another run.

## Risks / Trade-offs

- Experimental upstream APIs can change between releases -> pin the tested runtime, record the baseline and reject incompatible recovery; do not claim support from manifest inspection alone.
- The Pi model registry is not itself Durable's `Models` interface -> validate the public provider/auth bridge against custom configuration and refreshed credentials before completing the adapter.
- A storage commit cannot make shell effects transactional -> retain execution identities, preserve unsafe tool replay, inspect partial edits, and refuse recovery when old execution is uncertain.
- Durable close waits for code to honor cancellation -> await process cleanup and expose retained failures; document any observed host lifecycle limitation in known issues.
- Global Node floor increases by one patch release -> state >=22.19 consistently in metadata, development guidance and installation documentation.
- Persisted reports and prompts can contain project content -> keep them in the user's local Pi state with normal user-only access, never credential values, and expose their location for deliberate cleanup.

## Migration Plan

1. Add the Pi-only implementation and metadata, generate both bundles and validate the package without modifying bb/OpenCode control paths.
2. Run `npm ci` on Node >=22.19 and `npm run check`; verify the installed tarball includes both entries and the shared script and performs no build during installation.
3. Run the three explicit Pi fixture scenarios and existing host regression checks as appropriate; record actual dates, identities, outcomes and any unavailable checks in `docs/verification.md`.
4. Document installation, command syntax, explicit recovery, Node compatibility, storage location and cleanup limitations before release.

Existing users have no Pi records to migrate. Rolling back the package leaves saved Pi reports intact; use the matching version for resume or the current adapter's compatible cleanup path for stop. Incompatible state must not be deleted automatically. No implementation or live compatibility validation has been performed during this proposal.
