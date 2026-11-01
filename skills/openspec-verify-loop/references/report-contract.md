# Worker reports

The controller sends the exact versioned JSON schema with every assignment.
Return one final JSON object (a whole JSON code fence is accepted), with no
surrounding commentary. Include the complete Markdown report in
`fullReportMarkdown`. A short summary cannot substitute for the complete report.

Copy `schemaVersion`, `runId`, `round`, `changeName`, `targetPath`, and `role`
exactly from the assignment. Session/input IDs are attached by the controller.

Verifier reports include `verificationComplete`, `findings`, `notVerified`,
`priorFindingResolutions`, `blockers`, and `fullReportMarkdown`. Put the
procedure's normal report, unchanged, in `fullReportMarkdown`, then copy each of
its CRITICAL/WARNING/SUGGESTION issues into `findings` with the same severity and
each check it left not verified or skipped into `notVerified`. Checks the report
marks Not applicable are not gaps; leave them out of `notVerified`. Each finding needs
a stable ID, severity, category, title, explanation, locations, and actionable
recommendation. Do not reclassify issues or rate dimensions for the loop: the
controller derives the outcome.

Resolved findings need concrete evidence. A `notVerified` entry needs a reason;
mark it `repairable: false` only for external prerequisites the fixer cannot
provide, which block the run. Every prior finding must have a resolution, even if
a fix introduced a new issue. Never omit unverified checks to obtain a clean
verdict. Failed controller checks become `evidence:<n>` findings for the fixer.

Fixer reports include `outcome`, `addressedFindings`, `unresolvedFindings`,
`disputedFindings`, `changedFiles`, `checksRun`, `blockers`, and
`fullReportMarkdown`. Account for every supplied finding exactly once, with
evidence for addressed or disputed findings and reasons for unresolved findings.
A dispute is decided by the next fresh verifier. Check commands are argument arrays with a
working directory, exit code, evidence, and summary. Completed fixes have no
unresolved findings, blockers, or failed checks. A fixer cannot declare the loop
clean; a new full verifier must do that.

The controller retains raw output and validated JSON/Markdown reports per round.
Malformed, truncated, stale, or contradictory reports never advance to clean.
Handoffs carry complete structured issues, checks, and relevant fix dispositions
with paths to the full saved reports. Report Markdown and complete command output
stay on disk; bounded command excerpts always retain the actual exit status.
The verifier receives the procedure directly and need not rediscover or reload it.
Evidence from an earlier round does not replace the current round's independent
checks or a fresh assessment of every prior issue.
