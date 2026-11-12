# pi-integration Specification

## Purpose

Lets native Pi users run the shared OpenSpec verification loop, retain its reports and worker identities across interruptions, and explicitly resume unfinished work.

## Requirements

### Requirement: Pi package entry
The package SHALL install as a native Pi package with explicit extension resources and Node.js >=22.19 support. Pi SHALL NOT expose the bb-specific loop skill. Installing or loading the extension SHALL start no loop or worker. The existing bb entry and OpenCode default export SHALL remain available.

#### Scenario: Install on Pi
- **WHEN** a user installs the package from Git and starts Pi
- **THEN** its loop commands are available without a build during installation
- **AND** no loop starts and the bb-specific workflow skill is not exposed by this package

#### Scenario: Other hosts load their entries
- **WHEN** bb or OpenCode loads the installed package
- **THEN** it retains its existing entry and does not initialize a Pi harness

### Requirement: Native loop commands
The extension SHALL expose `/opsx-verify-loop [change] [--store <id>] [--max-rounds <n>]`, `/opsx-verify-loop-report [run-id]`, `/opsx-verify-loop-stop [run-id]` and `/opsx-verify-loop-resume [run-id]`. Start SHALL return a run identity before completion. Without a run ID, control commands SHALL select the checkout's unfinished run, or the latest terminal run for report, and reject ambiguity.

#### Scenario: Start a named change
- **WHEN** a user runs `/opsx-verify-loop add-export --store team-specs --max-rounds 3`
- **THEN** one background run starts with those arguments and the command returns its identity

#### Scenario: No change is supplied
- **WHEN** start omits a change name
- **THEN** the shared loop's first verifier selects the change or reports the existing ambiguity outcome

#### Scenario: Invalid or unrelated target
- **WHEN** arguments are malformed, a round limit is not a positive integer, the directory is outside Git, or a control command names another checkout's run
- **THEN** the command returns a specific error and starts no worker

### Requirement: Invoking settings and procedure
Start SHALL capture the invoking session's model, effective thinking level and working directory, plus exactly one advertised `openspec-verify-change` skill's absolute path. Workers SHALL use those settings and the project's context instructions. Missing or ambiguous procedure discovery, unavailable models or unresolved authentication SHALL refuse start without substituting a model or procedure. Credentials SHALL NOT be persisted in run records.

#### Scenario: Nested project with custom provider
- **WHEN** a user starts in `/repo/packages/app` using a configured provider and thinking level
- **THEN** workers use that directory, provider, model, thinking level, project instructions and selected verify procedure
- **AND** an unavailable configuration produces a prerequisite error instead of a fallback model

#### Scenario: Verify procedure is ambiguous
- **WHEN** Pi advertises multiple verify procedures or cannot expose their provenance unambiguously
- **THEN** start identifies the ambiguity and creates no worker

#### Scenario: Session settings later change
- **WHEN** the invoking Pi session switches model after start
- **THEN** the existing run's workers retain the captured model and thinking level

### Requirement: Fresh sequential workers
Every new loop worker call SHALL use a new conversation with no earlier worker transcript, in the saved invoking directory. Only one worker SHALL execute at a time. Verifiers SHALL receive read and shell tools; fixers SHALL additionally receive write and edit tools. Workers SHALL receive neither loop-management nor delegation tools, and SHALL retain the shared prompt rules.

#### Scenario: Verify then fix then verify
- **WHEN** the loop needs a fix and a subsequent verification
- **THEN** three distinct conversations execute sequentially with role-appropriate tools
- **AND** the fixer receives the complete verification report

#### Scenario: Restricted worker catalogue
- **WHEN** the parent Pi session has extra tools or extensions
- **THEN** workers receive only their explicit tool selection and cannot call inherited loop or delegation tools
- **AND** shell restrictions remain instructions rather than a claimed filesystem sandbox

### Requirement: Correlated worker outcome
Only a successfully answered submission with a complete final assistant response SHALL supply a worker reply. An unanswered, failed, aborted or truncated response SHALL end execution with the worker identity and reason, without starting another worker. An uncertain admission SHALL be reconciled from persisted identities; the plugin SHALL NOT resubmit a worker prompt or substitute a new conversation when correlation fails.

#### Scenario: Uncertain admission with a saved receipt
- **WHEN** the caller loses the admission response but storage identifies the admitted submission
- **THEN** observation reconnects to that submission without another prompt admission

#### Scenario: Missing admission identity
- **WHEN** the plugin cannot establish whether an attempted admission was committed
- **THEN** it reports failure, starts no replacement worker and attempts cleanup of known work

#### Scenario: Worker ends without an answer
- **WHEN** a worker hits a model failure, turn limit or incomplete final response
- **THEN** the run reports failure with that conversation's identity and starts no subsequent worker

### Requirement: Durable run records
The extension SHALL persist run identity, checkout and invoking directory, original arguments and budget, model and thinking level, procedure identity, loop identity, ordered worker calls, submission identities, complete replies and terminal results outside the working tree. Records SHALL survive Pi restart and remain available to report, which SHALL read them from the store itself, never from a copy. Interrupted side effects SHALL NOT be described as rolled back or exactly once.

#### Scenario: Restart after a reply was committed
- **WHEN** Pi exits after a worker reply is committed but before the next call begins
- **THEN** report can retrieve that complete reply and the run's saved settings after restart
- **AND** saving records creates no checkout files

#### Scenario: Report while another process writes
- **WHEN** a report is requested while the owning process keeps committing to the store
- **THEN** the report opens the store afresh and shows the records committed when it opened, never fewer than were committed before the request
- **AND** the report changes no file in the store, even one with a torn last line or an unconfirmed record

#### Scenario: Report before any run
- **WHEN** a report is requested in a checkout that has no saved state
- **THEN** it reports that no loop exists and creates no state directory

### Requirement: Saved call replay
Resume SHALL run the same loop definition with the saved arguments and budget, returning saved replies for completed calls and reconnecting to an unfinished call. It SHALL match each saved call's position, role and prompt before reuse. It SHALL NOT rerun completed workers, reset the round limit or introduce new round, verdict or prompt decisions outside the shared script.

#### Scenario: Resume after a completed fix
- **WHEN** verification and fix replies were saved before interruption
- **THEN** replay uses both replies without executing either worker again
- **AND** the next new worker is the subsequent fresh verifier within the original budget

#### Scenario: Resume an unfinished worker
- **WHEN** a run has a valid saved conversation and submission for its unfinished call
- **THEN** resume reconnects to that work and admits no duplicate prompt

#### Scenario: Saved calls diverge
- **WHEN** replay produces a different prompt or role for a saved call position
- **THEN** resume stops with a mismatch error and launches no new worker

### Requirement: Explicit recovery only
An interruption SHALL leave a resumable run rather than a clean result. Only an explicit resume command SHALL continue its work. Loading, reloading, listing progress or viewing reports SHALL make no model requests and run no worker tools. A new start SHALL refuse an unfinished run and identify resume and stop as the available actions. Terminal runs SHALL NOT be resumed.

#### Scenario: Restart and inspect
- **WHEN** Pi restarts after an interruption and the user views the report
- **THEN** it shows the interrupted state and saved progress without scheduling work

#### Scenario: Explicit resume
- **WHEN** the user requests resume for a compatible interrupted run
- **THEN** the existing run continues under the same run identity

#### Scenario: Start or resume an inappropriate run
- **WHEN** a user starts while an interrupted run exists, resumes an already running run, or resumes a terminal run
- **THEN** the command refuses the action and describes the existing state

### Requirement: Recovery compatibility
Before scheduling recovery, the extension SHALL verify the saved checkout and invoking directory, loop and adapter record versions, procedure content identity and original model/thinking availability. A mismatch SHALL preserve the run and reports, launch no worker and explain why resume is unavailable. Current credentials SHALL be resolved again rather than restored from storage.

#### Scenario: Upgrade changes the loop
- **WHEN** an installed update changes the loop identity needed by an interrupted run
- **THEN** resume refuses that run while report and cleanup remain available

#### Scenario: Procedure or credentials change
- **WHEN** the original procedure content differs or the original provider can no longer authenticate
- **THEN** resume identifies that prerequisite and performs no worker work

### Requirement: Checkout ownership
Only one Pi process SHALL drive unfinished loop work in a canonical Git checkout. Sibling directories and symlink aliases SHALL share that ownership. Ownership SHALL be acquired before opening writable run storage or scheduling workers. Report SHALL need no ownership, SHALL open run storage only read-only and SHALL NOT write. An unavailable or uncertain owner SHALL prevent another start or resume; cleanup uncertainty SHALL retain the run's reservation.

#### Scenario: Competing Pi processes
- **WHEN** a second Pi process starts or resumes through a sibling directory or path alias while another process owns the checkout
- **THEN** it refuses to drive work and identifies the ownership conflict
- **AND** it can still report the owner's run

#### Scenario: Previous process died
- **WHEN** a process tries to recover an interrupted run whose prior owner died
- **THEN** it schedules work only after exclusive ownership and inactivity of prior execution are established
- **AND** uncertainty returns an actionable error rather than assuming that owner death stopped shell subprocesses

### Requirement: Intentional stop
Stop SHALL end a running or interrupted run as `stopped` only after all owned worker execution is confirmed inactive. It SHALL start no new worker or model request, including when cleaning an interrupted run. Unconfirmed cleanup SHALL report failure with worker identities, retain the reservation and allow an explicit stop retry. A stop accepted before terminal completion is committed SHALL win over completion.

#### Scenario: Stop during a fix
- **WHEN** the user stops an active fixer and interruption is confirmed
- **THEN** the run ends stopped and no following verifier starts
- **AND** that run cannot be resumed

#### Scenario: Stop after restart
- **WHEN** the user stops an interrupted run without first resuming it
- **THEN** only cleanup executes and the run ends stopped after inactivity is confirmed

#### Scenario: Cleanup fails and is retried
- **WHEN** interruption cannot be confirmed and the user later retries stop
- **THEN** the first attempt reports retained ownership and the later attempt retries cleanup without another prompt

### Requirement: Shutdown preserves unfinished work
Session shutdown, reload or replacement SHALL stop active execution before cleanup completes, close owned resources and retain unfinished runs for explicit resume. Shutdown SHALL NOT turn a suspended run into stopped, failed or clean solely because the host is closing. Cleanup failure SHALL identify outstanding work and SHALL NOT release its reservation or claim successful cleanup.

#### Scenario: Reload during a worker
- **WHEN** Pi reloads the extension during a worker call
- **THEN** active execution is interrupted before cleanup completes and the saved run is resumable
- **AND** the replacement extension starts no worker until explicitly asked to resume

#### Scenario: Host exits despite failed cleanup
- **WHEN** shutdown cannot establish worker inactivity
- **THEN** retained records identify cleanup uncertainty and future recovery requires reconciliation before scheduling work

### Requirement: Direct progress and reports
The extension SHALL display run identity, state, change when known, verification count, reason and complete saved worker reports through native Pi messages or renderers. Reporting SHALL trigger no model turn and SHALL NOT act on verdict prose. Terminal results SHALL remain retrievable after restart; repeated report requests SHALL NOT repeat a completion action.

#### Scenario: Completion while parent is busy
- **WHEN** the loop completes while the invoking session is processing unrelated work
- **THEN** the extension retains and displays its result without interrupting that work with a reporting model turn

#### Scenario: Report after restart or session replacement
- **WHEN** a user requests the saved run from another session in the same checkout
- **THEN** the report includes its terminal result or interrupted progress and access to complete worker reports
- **AND** no loop starts or resumes

### Requirement: Pending worker activity in reports
While a run is running and its last worker call is pending, a report SHALL show when the run's store last committed. While a call is pending only that worker commits, so this is when the worker last showed activity, such as streamed response or tool output, or, before any, when waiting for it began. Activity SHALL NOT change durable run records, post a notice, trigger a model turn or write to run storage from the reporting process.

#### Scenario: Long single response
- **WHEN** a verifier streams one response for several minutes without finishing it
- **THEN** a report requested during that response shows a last-activity time no more than a few seconds behind the latest streamed output
- **AND** the saved run records and their revision are unchanged by that activity

#### Scenario: Stalled worker
- **WHEN** a pending worker produces no output for several minutes
- **THEN** a report shows the last-activity time from before the silence or, if it produced none, the time waiting began, so the user can see that nothing has arrived since

#### Scenario: Call finishes or is stopped
- **WHEN** the pending call's reply or failure is saved, or the run is stopped during that call
- **THEN** later reports show no last-activity time for that call

#### Scenario: Report after the owner exits
- **WHEN** the owning process exits while a call is pending and a user requests a report from another session
- **THEN** the report shows the run as interrupted, without a last-activity time, and no loop starts or resumes
