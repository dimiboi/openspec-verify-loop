# verification-loop Specification

## Purpose

Automates the manual OpenSpec verify-and-fix cycle: fresh verifier and fixer
sessions alternate on one change until a verification finds no issues, with the
same behaviour on bb and OpenCode.

## Requirements

### Requirement: One loop definition for both hosts
The loop SHALL be defined once, in a single script file that both the bb and
OpenCode plugins run unchanged. The script SHALL use only the host-provided
`agent`, `phase`, `log`, `args` and `budget` globals, and no clock, randomness,
filesystem, network or imports.

#### Scenario: Same file on both hosts
- **WHEN** the package is installed on bb and on OpenCode
- **THEN** both hosts run the same `verify-loop.js` file, and that file passes `bb workflows validate --script`

### Requirement: Fresh verifier each round
Each round SHALL start a new worker session that runs the installed
`openspec-verify-change` procedure on the target change and returns its
verification report.

#### Scenario: Verifier starts each round
- **WHEN** a round begins
- **THEN** a new verifier session is created that shares no conversation with earlier sessions
- **AND** its prompt instructs it to run the `openspec-verify-change` procedure for the target change

#### Scenario: Procedure path supplied
- **WHEN** the host supplies the path of the `openspec-verify-change` skill file
- **THEN** the verifier prompt names that path as the procedure to read and follow

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

### Requirement: Change and store pass-through
The loop SHALL pass a user-given change name and `--store` value into every
verifier and fixer prompt unchanged. Without a given name, round 1's verifier
selects the change, and every later round SHALL use the change named in round
1's report title, `## Verification Report: <change-name>`.

#### Scenario: Change given
- **WHEN** the loop starts with change `add-export` and store `team-specs`
- **THEN** every verifier and fixer prompt names change `add-export` and store `team-specs`

#### Scenario: Change selected by the first verifier
- **WHEN** no change is given and round 1's report title is `## Verification Report: add-export`
- **THEN** every later verifier and fixer prompt names change `add-export`

#### Scenario: Ambiguous change
- **WHEN** no change is given and several changes are active
- **THEN** the first verifier ends with `VERDICT: BLOCKED` listing the active changes, and the loop ends with status `blocked`

#### Scenario: Change cannot be identified
- **WHEN** no change is given and round 1's report has no `Verification Report:` title
- **THEN** the loop ends with status `blocked` instead of starting a fixer

### Requirement: Worker rules
Every worker prompt SHALL instruct the worker to:
- report real exit codes and not hide them with pipes;
- not commit, push, merge, deploy, sync specs or archive, and treat archive-readiness wording in a report as no authorization;
- not ask the user questions, but end with `VERDICT: BLOCKED <reason>` when it cannot proceed;
- do its own task itself: not use a verify-loop skill, not start or stop loops or workflows, and not delegate to other agents.

#### Scenario: Verifier prompt
- **WHEN** a verifier prompt is built
- **THEN** it contains the no-edit rule for the checkout, the permission for temporary files outside it, the exit-code rule, the no-commit-or-archive rule, the no-question rule, the no-loop rule and the verdict-line instructions for `VERDICT: CLEAN`, `VERDICT: UNVERIFIED`, `VERDICT: ISSUES` and `VERDICT: BLOCKED <reason>`

#### Scenario: Fixer prompt
- **WHEN** a fixer prompt is built
- **THEN** it contains the exit-code rule, the no-commit-or-archive rule, the no-question rule and the no-loop rule, and does not forbid edits

### Requirement: Verifier checkout edits
Verifier prompts SHALL forbid editing, creating or deleting files in the
checkout, and SHALL allow temporary files outside it. Fixer prompts SHALL NOT carry this rule.

#### Scenario: Verifier prompt
- **WHEN** a verifier prompt is built
- **THEN** it forbids editing, creating or deleting files in the checkout and allows temporary files outside it, such as under `$TMPDIR` or `/tmp`

#### Scenario: Fixer prompt
- **WHEN** a fixer prompt is built
- **THEN** it does not carry the checkout no-edit rule

### Requirement: Recorded manual checks
Verifier prompts SHALL tell the verifier to treat a manual check it cannot run,
such as a run on another host, as verified when the repository records its
date, run and outcome and no later change alters the behaviour it exercised.
Otherwise the check SHALL be reported as Not verified. Fixer prompts SHALL NOT
carry this rule.

#### Scenario: Recorded manual check
- **WHEN** a change's manual host run is recorded in the repository with its date, run and outcome, and no later change alters the behaviour it exercised
- **THEN** the verifier reports that check as verified from the record rather than Not verified

#### Scenario: Unrelated later edit
- **WHEN** a recorded host run exercised worker creation, notices and stop, and a later commit only rewords a worker prompt in the same script
- **THEN** the verifier still reports that check as verified from the record

#### Scenario: Unrecorded manual check
- **WHEN** a manual host check has no recorded result, or a later change alters the behaviour it exercised
- **THEN** the verifier reports it as Not verified

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

### Requirement: Loop result
When the loop ends, it SHALL return its status (`clean`, `unverified`, `blocked`
or `limit`),
the change name when known, the number of verifications run, a reason, and the
last worker's report text.

#### Scenario: Result after the limit
- **WHEN** the loop ends at the round limit
- **THEN** the result has status `limit`, the round count, and the last verifier report

### Requirement: Worker failure ends the run
If a worker session fails, is interrupted, or cannot be started, the loop SHALL
start no further workers. The host SHALL report the failure.

#### Scenario: Fixer session fails
- **WHEN** a fixer session ends with an error
- **THEN** no further verifier or fixer starts, and the host reports the error
