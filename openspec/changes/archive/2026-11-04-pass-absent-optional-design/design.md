# Design

## Context

The `openspec-verify-change` skill already has two labels for a check it does
not run: **Not applicable**, for checks the schema does not define or artifacts
the status reports as skipped, which it excludes from skipped-check counts; and
**Not verified**, for applicable checks with missing evidence. A missing
`design.md` gets Not verified, because `openspec status` reports the design
artifact as `ready`, not skipped. The loop's clean rule rejects any check
marked Not verified at a line start, in a table cell or after a colon.

## Goals / Non-Goals

**Goals:**
- A change without `design.md` and with no other gaps ends `clean`.
- The clean rule, the unverified rule and the routing in `verify-loop.js` stay
  as they are.

**Non-Goals:**
- Detecting a change that needed a design but has none.
- Treating any other Not verified check as passing.

## Decisions

1. **A verifier-prompt rule, not a script rule.** The verifier is told to label
   Design Adherence Not applicable when `design.md` is absent. This uses the
   skill's own label and follows the existing pattern of the recorded
   manual-check rule, which also tells the verifier how to label a check.
   Rejected alternative: have the script ignore a Not verified mark on a Design
   Adherence line. That needs the script to parse free-form report lines, and
   to override the verifier's `VERDICT: UNVERIFIED`, which would break the
   invariant that clean requires `VERDICT: CLEAN`.
2. **The fixer prompt keeps its optional-artifact rule.** A verifier can still
   ignore the new rule and mark the check Not verified; fixers must still never
   create `design.md` to clear it.

## Risks / Trade-offs

- [A change that needed a design ends `clean` without one] → Accepted by the
  user. Completeness and correctness checks still run against the proposal,
  specs and tasks.
- [A verifier keeps the skill's wording and marks the check Not verified] → The
  run ends `unverified`, as before; no worse than today.
