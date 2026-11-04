# Proposal

## Why

The clean and unverified rules scan the whole verifier report for a nonzero
severity count or a check marked `Not verified`. A report about a change to
those rules has to describe their test inputs, so it quotes such marks in its
coverage sections. On `pass-absent-optional-design`, run
`wfr_edb86a01-afb7-4ee8-a659-83f82b698cca` quoted the fixture
"Tests: Not verified (node_modules missing)". On `ignore-quoted-not-verified`
itself, run `wfr_fc7b9c54-07c1-4a9b-9383-17671e929926` quoted
`` `"2 warning(s)"` `` and ``- **Tests:** `Not verified` ``. Each time, the
verifier found no issues, wrote "All checks passed" and ended `VERDICT: CLEAN`,
and the loop still sent the report to a fixer that had nothing to fix. The
second run kept doing so every round until it was cancelled.

## What Changes

- When a report has a Final Assessment section, the clean and unverified rules
  read only that section, from its last heading to the end of the reply. The
  `openspec-verify-change` skill requires that section to state every nonzero
  count and to name every skipped check ("<check> not verified: <reason>"), so
  any `not verified` there counts, wherever it appears in a line.
- A report without a Final Assessment section is read as a whole, as before,
  except that text inside double quotes (`"…"` or `“…”`) on one line is no
  longer a `Not verified` mark. Backticks still count, and the mark pattern
  now also catches a status written as code after a colon, for example
  ``- **Tests:** `Not verified` ``, which it used to miss.
- Severity counts are read from the same text as the marks, quotations
  included.
- **BREAKING**: a report whose body marks a check `Not verified` or lists a
  warning, but whose Final Assessment says "All checks passed" and whose
  verdict is `VERDICT: CLEAN`, now ends `clean`. The verifier would have to
  contradict the skill's own rules twice for that to happen.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-loop`: the clean and unverified rules are decided from the
  Final Assessment section when the report has one; without one, quoted
  `Not verified` text is not a mark.

## Impact

- `skills/openspec-verify-loop/verify-loop.js`: one helper that picks the text
  to judge, used by the clean and unverified checks, and a widened mark
  pattern. Both hosts run it.
- `tests/loop.test.ts`: cases built from the observed reports.
- `AGENTS.md`, `README.md`, `docs/verification.md`: the clean and unverified
  rules, the test coverage, and a validation record.
- No routing, prompt, host adapter, dependency or API change.
