# Spec Delta

## MODIFIED Requirements

### Requirement: Report text judged for clean and unverified
When a report has a Final Assessment heading, the clean and unverified rules
SHALL read only the text from its last such heading to the end of the reply,
and any `not verified` there SHALL count as a skipped check. Without that
heading they SHALL read the whole report, where a `Not verified` mark counts
only at a line start, in a table cell or after a colon, not inside double
quotes on one line; backticks SHALL still count. For nonzero severity counts,
Markdown emphasis or code marks around the number or severity word SHALL NOT
hide a count that would be recognized without those marks. This normalization
SHALL NOT change which report text is judged or the quoted-status rules.

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
