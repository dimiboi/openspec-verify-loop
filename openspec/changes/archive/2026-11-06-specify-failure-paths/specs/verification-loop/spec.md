## MODIFIED Requirements

### Requirement: Report text judged for clean and unverified
With a Final Assessment heading, the clean and unverified rules SHALL read
only the text from the last such heading to the end of the reply, where any
`not verified` counts as a skipped check. Without one they SHALL read the whole
report, where `Not verified` counts only at a line start, in a table cell or
after a colon, and not inside double quotes on one line. Emphasis or code marks
SHALL NOT hide a nonzero severity count.

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

#### Scenario: Emphasized severity word contradicts clean
- **WHEN** the judged report text contains `1 **warning** to fix.` and the verifier ends with `VERDICT: CLEAN`
- **THEN** the loop treats the verification as having issues
- **AND** it starts a fixer when rounds remain or ends limit on the last round

#### Scenario: Emphasized count contradicts unverified
- **WHEN** the judged report text contains `**1** warning(s)` and a genuine Not verified check, and the verifier ends with `VERDICT: UNVERIFIED`
- **THEN** the loop treats the verification as having issues rather than ending unverified

#### Scenario: Severity formatting is equivalent
- **WHEN** a positive critical, warning or suggestion count in the judged text wraps its number or severity word in asterisks, underscores or backticks
- **THEN** it has the same effect on clean and unverified decisions as the count without those marks

#### Scenario: Emphasized zero counts remain clean
- **WHEN** the judged report text contains only zero severity counts, including `**0** warnings`, has no Not verified check, and ends with `VERDICT: CLEAN`
- **THEN** the loop ends clean without a fixer

#### Scenario: Emphasized counts before the Final Assessment
- **WHEN** an earlier report section quotes `1 **warning**` but the last Final Assessment reports all checks passed and ends with `VERDICT: CLEAN`
- **THEN** the loop judges only the last Final Assessment and ends clean

### Requirement: Round limit
The loop SHALL run at most `maxRounds` verifications, defaulting to 5. The last
round SHALL be a verification, so no fix runs without a following
verification. On bb the limit SHALL also fit the Workflows agent-call budget.
A `maxRounds` that is not a positive integer SHALL fail the run before any
worker starts.

#### Scenario: Limit reached
- **WHEN** the verification in round `maxRounds` still has issues
- **THEN** the loop ends with status `limit` and starts no fixer

#### Scenario: Small call budget
- **WHEN** the Workflows budget allows fewer agent calls than `2 * maxRounds - 1`
- **THEN** the loop lowers its round limit so that every fix it starts is followed by a verification

#### Scenario: Invalid round limit
- **WHEN** `maxRounds` is zero, negative, fractional, not finite, or not a number
- **THEN** the run fails with an error saying `maxRounds` must be a positive integer, and no worker starts
