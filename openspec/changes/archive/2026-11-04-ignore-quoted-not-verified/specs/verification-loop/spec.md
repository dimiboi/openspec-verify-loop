# Spec Delta

## ADDED Requirements

### Requirement: Report text judged for clean and unverified
When a report has a Final Assessment heading, the clean and unverified rules
SHALL read only the text from its last such heading to the end of the reply,
and any `not verified` there SHALL count as a skipped check. Without that
heading they SHALL read the whole report, where a `Not verified` mark counts
only at a line start, in a table cell or after a colon, not inside double
quotes on one line; backticks SHALL still count.

#### Scenario: Body quotes test inputs
- **WHEN** a report's coverage section quotes `` `"2 warning(s)"` `` and ``- **Tests:** `Not verified` ``, its Final Assessment reads "All checks passed. Ready for archive.", and it ends with `VERDICT: CLEAN`
- **THEN** the loop ends with status `clean` and starts no fixer

#### Scenario: Skipped check named in the Final Assessment
- **WHEN** a report's Final Assessment reads "No critical issues found in the checks that ran. Tests not verified: node_modules missing." and the reply ends with `VERDICT: CLEAN`
- **THEN** the loop treats the verification as having issues
- **AND** the same report ending with `VERDICT: UNVERIFIED` ends with status `unverified`

#### Scenario: Count in the Final Assessment
- **WHEN** a report's Final Assessment reads "No critical issues. 1 warning(s) to consider." and the reply ends with `VERDICT: CLEAN`
- **THEN** the loop treats the verification as having issues

#### Scenario: Report without a Final Assessment quotes a fixture
- **WHEN** a report with no Final Assessment heading ends with `VERDICT: CLEAN` and mentions `Not verified` only in a quotation such as `the fixture is now "Tests: Not verified (node_modules missing)"`
- **THEN** the loop ends with status `clean`

#### Scenario: Status in backticks without a Final Assessment
- **WHEN** a report with no Final Assessment heading ends with `VERDICT: CLEAN` and contains ``- **Tests:** `Not verified` ``, or quotes "2 warning(s)"
- **THEN** the loop treats the verification as having issues

## MODIFIED Requirements

### Requirement: Clean stop
The loop SHALL end with status `clean` only when the verifier's last non-empty
line is `VERDICT: CLEAN` and the report text judged for clean shows no nonzero
count of critical issues, warnings or suggestions, and no `Not verified`
check.

#### Scenario: Clean verification
- **WHEN** the verifier report ends with `VERDICT: CLEAN` and its final assessment reads "All checks passed. Ready for archive."
- **THEN** the loop ends with status `clean` and starts no fixer

#### Scenario: Clean verdict contradicted by the report
- **WHEN** the verifier report ends with `VERDICT: CLEAN` but contains "2 warning(s)" or a `Not verified` check in the text judged for clean
- **THEN** the loop treats the verification as having issues

### Requirement: Unverified stop
The loop SHALL end with status `unverified`, and start no fixer, when the
verifier's last non-empty line is `VERDICT: UNVERIFIED`, the report text
judged for clean shows no nonzero count of critical issues, warnings or
suggestions, and at least one check is marked `Not verified` there. A
`VERDICT: UNVERIFIED` line that the report contradicts SHALL be treated as
issues.

#### Scenario: Only Not verified checks remain
- **WHEN** the verifier report has no issues, marks the test run `Not verified` because the project's dependencies are not installed, and ends with `VERDICT: UNVERIFIED`
- **THEN** the loop ends with status `unverified` and starts no fixer, also when the round is the last

#### Scenario: Unverified verdict contradicted by the report
- **WHEN** the verifier report ends with `VERDICT: UNVERIFIED` but contains "1 warning(s)" or no `Not verified` check in the text judged for clean
- **THEN** the loop treats the verification as having issues
