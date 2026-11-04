# Spec Delta

## MODIFIED Requirements

### Requirement: Worker rules
Every worker prompt SHALL instruct the worker to:
- report real exit codes and not hide them with pipes;
- not commit, push, merge, deploy, sync specs or archive, and treat archive-readiness wording in a report as no authorization;
- not ask the user questions, but end with `VERDICT: BLOCKED <reason>` when it cannot proceed.

Verifier prompts SHALL also forbid editing, creating or deleting files in the
checkout, and SHALL allow temporary files outside it.

#### Scenario: Verifier prompt
- **WHEN** a verifier prompt is built
- **THEN** it contains the no-edit rule for the checkout, the permission for temporary files outside it, the exit-code rule, the no-commit-or-archive rule, the no-question rule and the verdict-line instructions for `VERDICT: CLEAN`, `VERDICT: UNVERIFIED`, `VERDICT: ISSUES` and `VERDICT: BLOCKED <reason>`

#### Scenario: Fixer prompt
- **WHEN** a fixer prompt is built
- **THEN** it contains the exit-code rule, the no-commit-or-archive rule and the no-question rule, and does not forbid edits
