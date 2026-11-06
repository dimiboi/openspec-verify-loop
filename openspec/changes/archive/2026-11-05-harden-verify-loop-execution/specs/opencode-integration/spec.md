# Spec Delta

## MODIFIED Requirements

### Requirement: Start a run
The `/opsx-verify-loop [change]` command, and the tool's `run` action with optional
`change`, `store` and `maxRounds`, SHALL start the shared loop script in the
background. The call returns at once with outcome `started` and the selected
worker model. A second start in the same checkout SHALL be refused while a run
is active or a worker's termination remains unconfirmed after a failed run.

#### Scenario: Start returns immediately
- **WHEN** the user runs `/opsx-verify-loop add-export`
- **THEN** the call returns `started` with the worker model while the loop continues in the background

#### Scenario: Already running
- **WHEN** a run is active in the checkout and another start is requested
- **THEN** the second start is refused and the active run continues

#### Scenario: Failed run still owns a worker
- **WHEN** a run has reported failure but its worker's termination is unconfirmed and another start is requested in that checkout
- **THEN** the second start is refused and the response identifies the worker requiring cleanup

### Requirement: Worker sessions and permissions
Each worker SHALL be a new session in the invoking project directory within the
checkout, on the plugin's own hosting server. Verifier sessions SHALL be denied
the edit tool. Every worker session SHALL be denied subagents and the
`openspec_verify_loop` tool. A worker session SHALL NOT be able to start, or
stop, a loop.

#### Scenario: Verifier session
- **WHEN** a verifier session is created
- **THEN** its permissions deny the edit tool, subagents and the loop tool, and it runs in the invoking project directory

#### Scenario: Worker tries to start a loop
- **WHEN** a worker session calls the loop tool or a loop command
- **THEN** the call is rejected and no run starts

### Requirement: Worker waiting for input ends the run
If a worker session waits for a permission or a question, the loop SHALL stop
executing and interrupt that worker. With confirmed interruption the result
SHALL be `blocked`, naming the session and request. With unconfirmed interruption
the result SHALL be `failed`, naming the session, request and cleanup failure,
and the checkout SHALL remain reserved for cleanup.

#### Scenario: Permission request
- **WHEN** a verifier session raises a permission request and interruption succeeds
- **THEN** the run ends blocked, the result names that session and the request, and the session is interrupted

#### Scenario: Permission request cannot be interrupted
- **WHEN** a worker raises a permission request and its interruption cannot be confirmed
- **THEN** the run ends failed with the worker session, pending request and cleanup failure in its reason
- **AND** the checkout remains reserved and another explicit stop can retry cleanup

### Requirement: Stop and unload
The stop command and tool action SHALL report `stopped` only after the worker
is confirmed inactive. Unconfirmed cleanup SHALL return `failed` and retain the
checkout reservation for a later explicit stop. Cancellation accepted before
the run's terminal result is committed SHALL win over completion. Plugin cleanup
SHALL interrupt retained workers before succeeding; unconfirmed cleanup SHALL
reject unload cleanup and remain retryable.

#### Scenario: User stops a run
- **WHEN** the user runs `/opsx-verify-loop-stop` during a fix and interruption succeeds
- **THEN** the fixer session is interrupted and the run ends as stopped

#### Scenario: Stop from the starting session
- **WHEN** the session that started the run runs `/opsx-verify-loop-stop` and the run sends its stopped notice
- **THEN** that session receives only the run's `stopped` notice, not a second notice for the stop command

#### Scenario: Stop from another session
- **WHEN** a different session in the checkout runs `/opsx-verify-loop-stop` and interruption succeeds
- **THEN** the run's `stopped` notice goes to the starting session, and the stopping session receives the stop command's result

#### Scenario: Plugin unload during a run
- **WHEN** OpenCode unloads the plugin while a worker runs and interruption succeeds
- **THEN** that worker session is interrupted before unloading completes

#### Scenario: Stop cannot confirm interruption
- **WHEN** an explicit stop gets a negative interruption confirmation or an interruption request throws
- **THEN** the stop returns failed with the worker session and cleanup failure in its reason
- **AND** no successful stop is reported and the checkout remains reserved without automatic background retries

#### Scenario: Later stop retries retained cleanup
- **WHEN** a run has failed with unconfirmed cleanup and a later explicit stop confirms that the retained worker is inactive
- **THEN** the stop returns stopped, the checkout reservation is released, and a new run can start
- **AND** cleanup submits no worker prompt and starts no new worker

#### Scenario: Stop during the final observation
- **WHEN** a stop is accepted while the final worker observation is pending and before the run's terminal result is committed
- **THEN** the run and stop response report stopped once the worker is confirmed inactive
- **AND** the completion notice does not report clean

#### Scenario: Stop after completion was committed
- **WHEN** a successful run's terminal result has already been committed and its reservation released before a stop arrives
- **THEN** the stop returns not_running and does not change the completed result

#### Scenario: Unload encounters retained cleanup failure
- **WHEN** plugin cleanup cannot confirm termination of an active worker or one retained after a failed run
- **THEN** cleanup rejects with the worker identity and failure instead of resolving successfully
- **AND** cleanup does not dispose the loop controls before the worker can be cleaned up, and a later cleanup attempt can retry

### Requirement: Result notice
When loop execution ends, the starting session SHALL receive one queued notice
with its result or failure. The reporting turn SHALL have no tools. Cleanup
failure notices SHALL identify the worker and retained checkout reservation.
Later stop attempts SHALL receive their own outcome without sending another
terminal run notice; a command reply SHALL be suppressed only when the same
invocation already answered its caller through the run notice.

#### Scenario: Run ends
- **WHEN** a run ends with any status
- **THEN** the starting session receives a notice with that result, and the reporting turn cannot call tools

#### Scenario: Failed stop from the starting session
- **WHEN** the starting session requests a stop that causes the run to end with unconfirmed cleanup
- **THEN** that session receives the failure and retained-worker information once for that invocation
- **AND** the response does not claim stopped

#### Scenario: Cleanup retry from the starting session
- **WHEN** the starting session retries a stop after the run has already sent its failure notice
- **THEN** that stop receives its cleanup outcome even though the caller is the original session
- **AND** no second terminal notice is sent for the failed run

## ADDED Requirements

### Requirement: Worker cleanup ownership
The plugin SHALL retain a dispatched worker's identity and ability to interrupt
it until its terminal state is confirmed. If a request fails while the worker
may still run, it SHALL attempt cleanup before releasing the checkout.
Unconfirmed cleanup SHALL end execution as failed, preserve the original cause
and cleanup failure, and retain the checkout reservation. Cleanup SHALL NOT
resubmit a prompt.

#### Scenario: Observation request fails during a fix
- **WHEN** a fixer may be active and a request used to observe it fails
- **THEN** the plugin attempts to interrupt that fixer, starts no further workers and reports the observation failure
- **AND** the checkout is released only after termination is confirmed

#### Scenario: Observation failure and cleanup failure
- **WHEN** an observation request fails and interruption cannot be confirmed
- **THEN** the failed result includes the original error, worker session and cleanup failure
- **AND** another run is refused until explicit cleanup succeeds

#### Scenario: Prompt admission remains uncertain
- **WHEN** submission errors and reconciliation cannot establish whether the prompt was admitted
- **THEN** the loop fails without a second submission and attempts cleanup of the possibly active worker
- **AND** unconfirmed cleanup retains the checkout reservation

#### Scenario: Cancellation during worker creation
- **WHEN** a stop is accepted while a new worker session is being created and before its prompt is submitted
- **THEN** the plugin does not dispatch a new prompt after discovering the cancellation
- **AND** any session or possibly admitted work is reconciled and cleaned up before ownership is released

### Requirement: Invoking directory and checkout identity
The plugin SHALL discover project skills and available models and run workers
from the invoking session's effective directory, including a represented
subpath. Checkout reservations SHALL use the canonical Git checkout root, so
different invoking directories or aliases in that checkout share one
reservation. Stopping from any directory in that checkout SHALL address the
same retained run.

#### Scenario: Nested OpenSpec project
- **WHEN** a session invokes a loop from `/repo/packages/app` with its own OpenSpec project
- **THEN** project discovery and workers use `/repo/packages/app` rather than `/repo`
- **AND** the reservation is shared by the whole `/repo` checkout

#### Scenario: Session represents its directory with a subpath
- **WHEN** the host represents the invoking directory as a checkout location plus `packages/app` as its session subpath
- **THEN** project discovery and worker execution retain the effective `/repo/packages/app` directory

#### Scenario: Sibling project or alias requests another run
- **WHEN** a checkout has an active run or retained cleanup and a session in a sibling directory or canonical path alias requests a run
- **THEN** the second start is refused under the same checkout reservation
- **AND** a stop from that session targets the existing worker without changing its working directory
