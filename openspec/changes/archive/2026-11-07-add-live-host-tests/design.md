# Design

## Context

See `proposal.md` for motivation and `specs/live-host-testing/spec.md` for the behavior contract. The current `npm test` glob is `tests/*.test.ts`; `npm run check` type-checks, bundles, runs those deterministic tests and validates packaging. The package's `files` allowlist excludes development tests.

`docs/verification.md` already defines host checks. The disposable OpenCode driver from the observed run uses the installed client to discover the service, wait for commands, create a session and dispatch `session.command`; its separate inspectors truncate messages. Existing production code demonstrates message pagination, worker metadata, and the difference between command `outcome` and terminal run `status`.

Host constraints shape the harness: bb's installation is global, workflow queries require the run's project context, and ACP slash text alone does not select a bb skill. OpenCode 2.2.5 requires a complete local plugin package, can advertise an empty initial catalogue, and can queue notices behind reporting turns. Read the recorded workarounds in `docs/known-issues.md`; this change does not alter them.

## Goals / Non-Goals

**Goals:**

- Keep reusable fixture preparation, final checks and evidence handling small, with independent host drivers using native controls.
- Preserve one identifiable attempt, including unsuccessful convergence and incomplete cleanup, without depending on model summaries for the test result.
- Exercise public skill/command entry and observable reporting while running the production shared loop unchanged.

**Non-Goals:**

- A new loop executor, production timeout, production evidence ledger or new worker scope rules.
- Automated coverage of every verdict, native unload, injected cleanup failures, remote Git installation or provider discovery bug.
- A filesystem sandbox, automatic model fallback, repeated attempts until success, or changes to global bb/OpenCode configuration.

## Decisions

### 1. Two development entry points with shared local helpers

Add `tests/live/bb.ts`, `tests/live/opencode.ts`, a small shared helper module, and `tests/live/fixtures/greeting/`. Use the installed `tsx`, Node standard library, bb CLI and pinned OpenCode client. Add `test:live:bb` and `test:live:opencode` npm scripts; leave the existing deterministic test glob unchanged. Harness logic receives fake command/client boundaries in focused top-level deterministic tests.

Each live invocation selects exactly one `--scenario fix-to-clean|stop`. Require `--model` and `--procedure <installed SKILL.md>`; bb also requires an explicit provider and permission mode, with optional reasoning selection. OpenCode accepts the chosen provider/model/variant as structured input or separately parsed fields. Provide finite `--timeout` and `--cleanup-timeout` values and an optional output parent; resolve actual host settings and record them before starting. Suggested defaults are 60 minutes for the attempt and 60 seconds for cleanup, adjustable for slower local models.

Alternatives: adding live cases to the existing test command risks accidental model calls; a generic host-testing framework adds interfaces beyond the two known drivers. Keep shared code limited to actual common preparation, checks and evidence operations.

### 2. Fresh seed with controller-owned checks

Store only the minimal greeting application and active OpenSpec change, including its `.openspec.yaml`, in the committed fixture. Use a neutral initial commit message. Seed the wrong punctuation and missing default behavior, a failing `node --test` check, and completed task markers corresponding to the claimed implementation. The change intentionally lacks `design.md`.

Every attempt creates a new directory outside the source checkout:

```text
attempt/
  fixture/       # the only Git checkout workers are asked to modify
  plugin/        # OpenCode's runnable package snapshot, when applicable
  evidence/      # raw records, assertions, diff and summary
```

Copy the supplied installed procedure directory, including relative resources, into one fixture skill location appropriate to the selected host. Record its original source and copied content hashes; verify the catalogue and actual procedure path passed into the workflow agree. Do not copy a developer's whole skill collection or fabricate a simplified verifier. Ambiguity fails setup with the advertised paths.

Before launch, check the baseline defects and failing test. After a fix-to-clean run, a controller-owned script outside `fixture/` imports `greet.mjs` in a fresh process and asserts `greet('Ada')`, `greet('')` and `greet()` against fixed expectations. Run the fixture test command separately and check the change still lacks `design.md`. A fixer can legitimately edit fixture tests; those tests cannot replace the controller's expectations.

Alternative: reusing an external sandbox or resetting a shared worktree makes the initial state dependent on previous runs and creates unnecessary reset risk.

### 3. bb uses its installed skill and explicit installation setup

Require the loop plugin to be installed from the checkout selected for testing and Workflows to be enabled. Compare the advertised installation source, record the source revision, dirty state and relevant file hashes, and fail with an explicit setup command if it differs. The harness does not install, enable or restore global plugins itself. Record hashes again after the attempt and fail if the tested plugin files changed during it.

Create a fixture bb project and a normal thread attached to its fresh Git directory. Set the requested provider/model/reasoning/mode on that thread; use `auto` or `full`, including `full` for ACP. Prompt it to use the installed `openspec-verify-loop` skill on the named change; naming the skill works across providers without treating ACP slash text as a skill invocation.

Discover the run from that thread's structured tool events and matching preview. Query status/history with the controller's environment scoped to the project and thread it created, rather than the parent development thread. Follow history `nextCursor` pages and thread event sequences. Compare worker identities and settings, and wait through the completion reporting turn before asserting that it launched nothing else. The skill launch establishes the starting thread's access. Worker skill hiding remains covered by `tests/bb-server.test.ts`; do not record live catalogue observations, since `bb thread commands` does not list bb plugin skills.

For the stop scenario, observe active work and send a user stop request to the starting thread. Require its normal `bb workflows stop` call and the host's cancellation result. A direct CLI stop is available for emergency cleanup but cannot establish success for this scenario.

Alternative: starting the script directly with `bb workflows run` omits skill selection, procedure-path choice, argument passing, the preview and completion behavior this test exists to exercise.

### 4. OpenCode uses a complete snapshot on the existing service

Resolve repository resources relative to the driver's module location. Snapshot the package's manifest and published runtime resources plus the lockfile, then use `npm ci --omit=dev --ignore-scripts` in `plugin/` to resolve its external runtime dependencies. Record source revision/dirty state and snapshot hashes. Require the developer to run `npm run check` first so the committed bundle reflects the intended source; do not rebuild or copy only `dist/index.js` during a live attempt.

Configure only the fixture's local plugin entry to reference that complete snapshot. Discover the existing compatible service using the pinned client's service API, create the fixture location, and wait for its plugin, required native commands, loop skill and selected verify procedure. Record version and service process identity without persisting authentication headers. Empty initial catalogues are retryable reads within the readiness deadline; no global reload is used.

Create the origin session on the selected model and dispatch `session.command` once for `opsx-verify-loop`. Identify its run from marked synthetic notices, parse their JSON payloads, and find workers by run metadata. Start/command replies use `outcome`; final run results use `status`. Collect paginated messages and queued inbox notices, deduplicating by native identity. After each notice's reporting turn, check that no tool calls were emitted; this is evidence of observed behavior, not an additional proof of the permission hook's enforcement.

For stop, dispatch `opsx-verify-loop-stop` from the origin session after a worker is observed active. If it wins the race with natural completion, verify the stopped notice and inactivity. A run that completes first records `not_exercised` and exits nonzero. Do not slow workers or inject production behavior to force the scenario.

Alternative: pointing fixture configuration directly at the development checkout reveals that source path and permits the test input to change during a run. The snapshot removes that direct link; it does not restrict host filesystem permissions.

### 5. Assert host facts without rebuilding loop policy

The harness reads the production loop's terminal status and native worker history. It checks distinct worker identities, no overlapping workers, inherited model/settings, at least one fixer followed by a fresh verifier for fix-to-clean, and host-specific notices/reporting. It accepts additional rounds within the production bound and does not parse finding counts or implement another verdict policy.

The summary distinguishes scenario pass/fail/not-exercised and records the failure stage (`setup`, `execution`, `observation`, `assertion` or `cleanup`). A legitimate blocked/unverified/limit result is unsuccessful convergence, recorded with its actual result; an incorrect greeting after clean is an assertion failure. Neither is silently retried.

### 6. Evidence and cleanup belong to the attempt

Create evidence storage before work starts and append native records as observation advances. Write `result.json` and `summary.md` containing the identifiers, settings, hashes, assertion outcomes, final diff, terminal result and cleanup state, with links to complete raw thread/workflow or session records. Record missing or bounded-out collections explicitly. Keep authentication data out of logs.

Use request deadlines, an overall attempt deadline and a separate cleanup deadline; pagination must advance and cannot loop indefinitely. A failed or lost start response enters observation for the created origin identity, never another start. If no run can be correlated, preserve the uncertainty and known session/thread identities for manual recovery.

Handle completion, errors, timeout and SIGINT/SIGTERM through the same bounded cleanup path. Prefer the public stop path; if it fails and a known worker remains active, use only scoped native workflow/session controls and label that fallback. Confirm inactivity and empty pending work through host state rather than accepting a stop response alone. Retain fixture files, bb threads/projects and native sessions as evidence; cleanup here stops executions. The printed summary identifies retained resources for later manual removal. Unconfirmed or unknown work can never produce exit zero.

Alternative: deleting temporary directories immediately loses evidence and can leave live workers editing removed paths. A separate background supervisor or cross-crash recovery store is outside this change.

## Risks / Trade-offs

- Model runs vary in duration and convergence -> require explicit settings, finite adjustable deadlines and fresh attempts; assert behavior rather than exact prose or two-round completion.
- A worker can read outside the fixture or discover sibling evidence -> keep controller expectations separate and record this isolation limit; add no production scope workaround here.
- bb's plugin source affects all threads and can change during a test -> installation is an operator step and source hashes are checked before and after the attempt.
- Hosts can fail before worker identities are known, or the process can be killed without cleanup -> retain origin identities and partial evidence, report uncertainty and require manual recovery. Catchable interruptions use bounded cleanup.
- An installed verify skill can change behavior across machines -> copy and identify the selected procedure and resources; compare evidence using that provenance.
- Native transcript/catalogue shapes can change -> validate the small set of fields the driver relies on and report incompatible or incomplete evidence rather than a pass.

## Migration Plan

Add the fixture, helpers, drivers and focused deterministic harness tests, then expose the two npm commands. Update `docs/verification.md` with setup, scenario commands, expected assertions, retained resources and evidence review; replace its stale new-folder global-reload guidance with the existing scoped-readiness workaround. Keep unload/failure-injection recipes and historical results clearly separate.

Validate the implementation with `npm ci` and `npm run check`, then explicitly run each of the two scenarios on each available host and record outcomes. Until a live case is exercised, label it unverified rather than treating fake-adapter coverage as a host pass. Rollback removes the development commands and harness files; no production plugin or loop behavior requires migration.
