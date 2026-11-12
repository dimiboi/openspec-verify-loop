## MODIFIED Requirements

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
