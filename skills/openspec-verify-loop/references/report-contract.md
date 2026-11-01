# Worker reports

The controller sends the exact versioned JSON schema with every assignment.
Return one final JSON object (a whole JSON code fence is accepted), with no
surrounding commentary. Include the complete Markdown report in
`fullReportMarkdown`. A short summary cannot substitute for the complete report.

Copy `schemaVersion`, `runId`, `round`, `changeName`, `targetPath`, and `role`
exactly from the assignment. Session/input IDs are attached by the controller.

Verifier reports include `verificationComplete`, `outcome`, `findings`, `checks`,
`priorFindingResolutions`, `blockers`, and `fullReportMarkdown`. Preserve all
severities. Each finding needs a stable ID, severity, category, title,
explanation, locations, and actionable recommendation. Recommendations are
suggestions. Include individual procedure checks and aggregate checks with IDs
`completeness`, `correctness`, and `coherence`.

Verified checks and resolved findings need concrete evidence. A nonverified or
not-applicable check needs a reason. Missing evidence is `not_verified`, not
clean. Every prior finding must have a resolution, even if a fix introduced a
new issue. External prerequisites are blockers; repairable missing evidence
goes to the fixer. Never omit unverified checks to obtain a clean verdict.

Fixer reports include `outcome`, `addressedFindings`, `unresolvedFindings`,
`changedFiles`, `checksRun`, `blockers`, and `fullReportMarkdown`. Account for
every supplied finding exactly once, with evidence for addressed findings and
reasons for unresolved findings. Check commands are argument arrays with a
working directory, exit code, evidence, and summary. Completed fixes have no
unresolved findings, blockers, or failed checks. A fixer cannot declare the loop
clean; a new full verifier must do that.

The controller retains raw output and validated JSON/Markdown reports per round.
Malformed, truncated, stale, or contradictory reports never advance to clean.
