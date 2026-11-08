# Live Host Testing Specification

## Purpose

Lets maintainers repeat real bb and OpenCode loop checks from isolated fixtures, assess behavior independently of model reports, and retain enough evidence to investigate every attempt.

## Requirements

### Requirement: Explicit live execution
The repository SHALL provide separate opt-in live-test commands for bb and OpenCode, supporting `fix-to-clean` and `stop` scenarios. Live execution SHALL require a selected model and SHALL remain outside the default deterministic checks and distributed plugin resources.

#### Scenario: Ordinary development check
- **WHEN** a maintainer runs `npm run check`
- **THEN** no live-test driver contacts a host, starts a workflow or session, or requests a model response

#### Scenario: Explicit scenario
- **WHEN** a maintainer invokes a live command with a host, supported scenario and available selected model
- **THEN** the harness executes one attempt of that scenario and reports its evidence location

### Requirement: Fresh isolated fixture
Each attempt SHALL use a new Git checkout outside the plugin source checkout, seeded from a committed greeting fixture with an active OpenSpec change, known defects, failing tests and no `design.md`. The seed SHALL remain unchanged, and harness assertions, plugin snapshots and collected evidence SHALL reside outside the worker's checkout.

#### Scenario: Repeat after a successful fix
- **WHEN** a maintainer starts another attempt after a previous attempt fixed its fixture
- **THEN** the new checkout begins with the original defects and failing tests rather than the previous fixes

#### Scenario: Preparation records the baseline
- **WHEN** a fixture is prepared
- **THEN** its initial revision, failing checks and absence of `design.md` are recorded before the loop starts

### Requirement: Explicit settings and procedure provenance
The harness SHALL record the chosen host settings and the installed `openspec-verify-change` procedure's source and content identity. It SHALL verify the procedure actually selected for the run and each worker's inherited model/settings. Missing prerequisites, ambiguous procedure selection or unavailable models SHALL fail setup without silently substituting a model or procedure.

#### Scenario: Supplied procedure
- **WHEN** an installed verify procedure is supplied for a live attempt
- **THEN** the fixture exposes that procedure with its relative resources and the evidence identifies the copy actually passed to the verifier

#### Scenario: Wrong worker model
- **WHEN** a worker uses a different model or host-supported inherited setting from the starting thread or session
- **THEN** the harness reports an assertion failure even if the loop ends clean

### Requirement: bb skill entry and reporting
The bb driver SHALL exercise the installed loop skill through a normal fixture-project thread, verify the expected installed plugin source, and query workflow evidence in that project's context. It SHALL check a single launch and preview, the launch turn ending before completion, and completion reporting without relaunch. Worker skill hiding SHALL be covered by deterministic server-entry tests. It SHALL NOT change the global plugin installation or record live skill catalogue observations.

#### Scenario: bb fix-to-clean launch
- **WHEN** the bb scenario starts through the installed skill
- **THEN** one workflow receives the fixture change and selected procedure path, one matching preview is posted, and the launch turn ends without waiting for completion
- **AND** the starting thread launches through the loop skill; worker skill hiding is covered by deterministic server-entry tests
- **AND** the completion turn reports the result and starts no additional workflow

#### Scenario: Different plugin installed
- **WHEN** bb's installed plugin source differs from the source the maintainer selected for testing
- **THEN** setup reports the mismatch and the required explicit installation step without replacing the global installation

### Requirement: OpenCode native entry and host isolation
The OpenCode driver SHALL connect to an existing compatible service and exercise native loop commands using a complete runnable plugin snapshot configured only for its fixture. It SHALL wait for location-scoped plugin, command and skill availability. It SHALL NOT start, replace or stop a service or globally reload locations.

#### Scenario: New fixture location
- **WHEN** the first catalogue read for a configured fixture is empty
- **THEN** readiness observation continues within its deadline without resubmitting a start or performing a global reload

#### Scenario: Native command launch
- **WHEN** OpenCode is ready for the selected fixture and model
- **THEN** the driver dispatches the native start command once and correlates the resulting run with that session
- **AND** it checks one start notice, one terminal notice and reporting turns containing no tool calls

#### Scenario: No compatible service
- **WHEN** no existing compatible OpenCode service is reachable
- **THEN** setup fails with a prerequisite error and creates no replacement service

### Requirement: Fix-to-clean assertions
The fix-to-clean scenario SHALL pass only with a clean terminal result, at least one fixer followed by a fresh verifier, sequential workers with distinct identities, successful independent fixture checks and confirmed cleanup. It SHALL accept different round counts within the loop's configured bound and SHALL NOT require exact model prose.

#### Scenario: Successful repair
- **WHEN** the loop repairs the seeded greeting defects and later reaches clean with all scenario assertions satisfied
- **THEN** the harness reports the scenario passed and retains the worker sequence and final diff

#### Scenario: Unsuccessful convergence
- **WHEN** the loop ends blocked, unverified or at its round limit during fix-to-clean
- **THEN** the scenario does not pass, the loop's actual result is preserved, and no replacement attempt is launched automatically

### Requirement: Independent behavior checks
The harness SHALL assess the repaired fixture using its own unchanged expectations outside the worker's checkout, including named, empty and missing-name greetings. A passing scenario SHALL also require the fixture's test command to pass and `design.md` to remain absent. Worker reports or edited fixture tests alone SHALL NOT establish success.

#### Scenario: Fixture test weakened
- **WHEN** a fixer changes a fixture test to accept an incorrect greeting and the loop reports clean
- **THEN** the external behavior check fails the scenario

#### Scenario: Optional artifact invented
- **WHEN** the run creates a `design.md` for the seeded change
- **THEN** the scenario fails the optional-artifact assertion even if greeting checks pass

### Requirement: Active-worker stop
The stop scenario SHALL first observe an active worker, then request stop through the normal host interface: a user stop request to the bb starting thread or OpenCode's native stop command. It SHALL pass only after the host reports cancellation/stopped, the worker is confirmed inactive and no subsequent worker is started. Emergency cleanup SHALL NOT count as exercising the normal stop path.

#### Scenario: Stop while active
- **WHEN** a stop request reaches the loop while a worker is active
- **THEN** the scenario checks the terminal result and worker inactivity and reports pass only when the normal stop path succeeds

#### Scenario: Worker finished before stop
- **WHEN** the run completes before the stop request can exercise active cancellation
- **THEN** the attempt reports that stop was not exercised and exits unsuccessfully rather than claiming a stop pass or automatically starting another run

### Requirement: Correlated bounded observation
The harness SHALL collect complete paginated host evidence within finite configurable deadlines and correlate events by run and worker identities. It SHALL distinguish start/command outcomes from terminal run statuses, inspect delivered and queued notices where applicable, and report incomplete collection. An uncertain start SHALL be reconciled by observed identities without resubmission.

#### Scenario: Terminal status differs from start outcome
- **WHEN** OpenCode's start notice has `outcome: started` and its terminal notice has `status: clean` for the same run
- **THEN** observation recognizes completion without searching model prose for a matching word

#### Scenario: Evidence spans pages or remains queued
- **WHEN** relevant messages exceed one page or a terminal notice is queued behind a reporting turn
- **THEN** collection includes the additional pages and queued notice without truncating away scenario evidence

#### Scenario: Unknown start admission
- **WHEN** a start request's response is lost and observation cannot establish its run identity
- **THEN** the attempt records the uncertainty, performs scoped cleanup where identities are known, and never repeats the start

### Requirement: Reviewable attempt evidence
Every attempt SHALL retain machine-readable evidence and a concise human summary with the scenario outcome, host/version, tested plugin and fixture identities, procedure identity, selected settings, run/worker identities, complete collected host records, assertion results, final diff and cleanup outcome when available. Missing evidence SHALL be explicit, and credentials SHALL NOT be recorded.

#### Scenario: Unsuccessful attempt
- **WHEN** setup, execution, observation or assertions fail
- **THEN** evidence is retained with the failure stage and available identities, separately identifying an unsuccessful loop result from a setup or observation error

### Requirement: Confirmed cleanup and exit status
Completion, failure, deadline expiry and catchable process interruption SHALL enter bounded cleanup for the attempt's known work. The harness SHALL prefer normal host stop controls and record any scoped native fallback. It SHALL preserve artifacts while inactivity is unconfirmed and SHALL exit zero only when the requested scenario and cleanup both pass.

#### Scenario: Observation deadline expires
- **WHEN** a deadline expires while an attempt has known active work
- **THEN** the harness requests stop, checks inactivity within its cleanup deadline, retains evidence and exits nonzero without relaunching

#### Scenario: Cleanup cannot be confirmed
- **WHEN** the host cannot confirm a known worker is inactive
- **THEN** the harness retains its fixture and evidence, reports the remaining worker identity and cleanup failure, and exits nonzero
