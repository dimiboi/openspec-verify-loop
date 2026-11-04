# Spec Delta

## ADDED Requirements

### Requirement: Absent optional design
Verifier prompts SHALL tell the verifier that a change without `design.md` has
omitted an optional document, so Design Adherence is Not applicable rather than
Not verified, and is listed without the words "not verified". A change that has
`design.md` SHALL be checked against it as before. Fixer prompts SHALL NOT carry
this rule.

#### Scenario: Change without a design
- **WHEN** a verifier prompt is built and the change has no `design.md`
- **THEN** the prompt tells the verifier to report Design Adherence as Not applicable, not Not verified

#### Scenario: Clean without a design
- **WHEN** a change without `design.md` has no issues and no other check left unverified, and the verifier reports Design Adherence as Not applicable and ends with `VERDICT: CLEAN`
- **THEN** the loop ends with status `clean`

#### Scenario: Fixer prompt
- **WHEN** a fixer prompt is built
- **THEN** it does not carry the absent-design rule, and still forbids creating `design.md` or other optional artifacts to satisfy a check

## MODIFIED Requirements

### Requirement: Unverified stop
The loop SHALL end with status `unverified`, and start no fixer, when the
verifier's last non-empty line is `VERDICT: UNVERIFIED`, the report shows no
nonzero count of critical issues, warnings or suggestions, and at least one
check is marked `Not verified`. A `VERDICT: UNVERIFIED` line that the report
contradicts SHALL be treated as issues.

#### Scenario: Only Not verified checks remain
- **WHEN** the verifier report has no issues, marks the test run `Not verified` because the project's dependencies are not installed, and ends with `VERDICT: UNVERIFIED`
- **THEN** the loop ends with status `unverified` and starts no fixer, also when the round is the last

#### Scenario: Unverified verdict contradicted by the report
- **WHEN** the verifier report ends with `VERDICT: UNVERIFIED` but contains "1 warning(s)" or no `Not verified` check
- **THEN** the loop treats the verification as having issues
