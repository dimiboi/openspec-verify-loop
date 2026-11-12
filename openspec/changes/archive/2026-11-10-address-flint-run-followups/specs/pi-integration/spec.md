# Spec Delta

## ADDED Requirements

### Requirement: Pending worker activity in reports
While a worker call is pending, the owning process SHALL record when that worker last showed activity, such as streamed response or tool output, or, before any, when waiting for it began, and publish it to the report snapshot at most every 30 seconds. A report SHALL show this time for the unfinished call. Activity SHALL NOT change durable run records, post a notice, trigger a model turn or open run storage from the reporting process.

#### Scenario: Long single response
- **WHEN** a verifier streams one response for several minutes without finishing it
- **THEN** a report requested during that response shows a last-activity time no more than about 30 seconds behind the latest streamed output
- **AND** the saved run records and their revision are unchanged by that activity

#### Scenario: Stalled worker
- **WHEN** a pending worker produces no output for several minutes
- **THEN** a report shows the last-activity time from before the silence or, if it produced none, the time waiting began, so the user can see that nothing has arrived since

#### Scenario: Call finishes or is stopped
- **WHEN** the pending call's reply or failure is saved, or the run is stopped during that call
- **THEN** later reports show no last-activity time for that call

#### Scenario: Report after the owner exits
- **WHEN** the owning process exits while a call is pending and a user requests a report from another session
- **THEN** the report shows the last published activity time, or none if none was published, and no loop starts or resumes
