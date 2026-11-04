# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Verifier checkout edits
Verifier prompts SHALL forbid editing, creating or deleting files in the
checkout, and SHALL allow temporary files outside it. Fixer prompts SHALL NOT carry this rule.

#### Scenario: Verifier prompt
- **WHEN** a verifier prompt is built
- **THEN** it forbids editing, creating or deleting files in the checkout and allows temporary files outside it, such as under `$TMPDIR` or `/tmp`

#### Scenario: Fixer prompt
- **WHEN** a fixer prompt is built
- **THEN** it does not carry the checkout no-edit rule
