# Spec Delta

## ADDED Requirements

### Requirement: Verdict line reading
The loop SHALL read a worker's verdict from the last non-empty line of its
reply, ignoring Markdown emphasis or code marks around the verdict and a
trailing period. A reason after `VERDICT: BLOCKED` SHALL keep the characters
the worker wrote, apart from those marks.

#### Scenario: Emphasised or punctuated verdict
- **WHEN** a verifier's last non-empty line is `**VERDICT: CLEAN**`, `_VERDICT: CLEAN_` or `VERDICT: CLEAN.`, and the report shows no issues and no `Not verified` check
- **THEN** the loop ends with status `clean`

#### Scenario: Reason with underscores
- **WHEN** a worker's last non-empty line is `VERDICT: BLOCKED missing PAYMENTS_API_KEY`
- **THEN** the loop ends with status `blocked` and reason `missing PAYMENTS_API_KEY`

### Requirement: Unrecognized verdict
When a verifier's last non-empty line is not `VERDICT: CLEAN`,
`VERDICT: UNVERIFIED`, `VERDICT: ISSUES` or a `VERDICT: BLOCKED` line, the loop
SHALL end with status `blocked`, a reason saying the verifier result was not
recognized, and the reply as the report. It SHALL start no fixer, on any round.
A fixer reply needs no verdict line.

#### Scenario: Empty verifier reply
- **WHEN** a verifier returns an empty reply
- **THEN** the loop ends with status `blocked` and starts no fixer

#### Scenario: Report without a verdict line
- **WHEN** a verifier report lists a warning but its last non-empty line is not a verdict, such as `Verdict: issues`
- **THEN** the loop ends with status `blocked`, starts no fixer, and returns that report

#### Scenario: Unrecognized verdict on the last round
- **WHEN** the verification in round `maxRounds` has no verdict line
- **THEN** the loop ends with status `blocked`, not `limit`

#### Scenario: Fixer reply without a verdict
- **WHEN** a fixer's reply ends with a summary of its changes and no verdict line
- **THEN** the next round starts a new verifier

## MODIFIED Requirements

### Requirement: Fixer receives the full report
When a verifier reply ends with `VERDICT: ISSUES`, or with `VERDICT: CLEAN` or
`VERDICT: UNVERIFIED` that the report contradicts, and rounds remain, the loop
SHALL start a new fixer session whose prompt contains the verifier's complete
report and asks it to fix every critical issue, warning and suggestion. The
fixer prompt SHALL say that a `Not verified` check is not an issue and SHALL
forbid creating optional or intentionally omitted artifacts to satisfy a check.

#### Scenario: Issues found
- **WHEN** a verifier report ends with `VERDICT: ISSUES` and the round is not the last
- **THEN** a new fixer session receives the full report text unchanged
- **AND** the next round starts a new verifier after the fixer finishes

#### Scenario: Fixer prompt and optional artifacts
- **WHEN** a fixer prompt is built from a report that also marks Design Adherence `Not verified` because `design.md` is absent
- **THEN** the prompt forbids creating optional artifacts such as `design.md` to satisfy a check, and does not ask the fixer to resolve unverified checks

### Requirement: Blocked stop
The loop SHALL end with status `blocked` when a verifier or fixer ends its reply
with `VERDICT: BLOCKED`, optionally followed by a colon or dash and a reason,
and SHALL start no further workers. The result's reason SHALL be the worker's
reason, or say that the worker gave none.

#### Scenario: Missing prerequisite
- **WHEN** a worker's last non-empty line is `VERDICT: BLOCKED missing credentials for the payments sandbox`
- **THEN** the loop ends with status `blocked` and that reason

#### Scenario: Colon after BLOCKED
- **WHEN** a verifier's or fixer's last non-empty line is `VERDICT: BLOCKED: requirement conflict`
- **THEN** the loop ends with status `blocked` and reason `requirement conflict`

#### Scenario: Blocked without a reason
- **WHEN** no change is given, several changes are active, and the first verifier lists them and ends with a bare `VERDICT: BLOCKED`
- **THEN** the loop ends with status `blocked`, its reason says no reason was given, and its report contains the list
- **AND** this holds with `maxRounds` 1, where the loop does not end `limit`
