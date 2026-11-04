# Future improvements

Possible additions to the loop. None is planned: each waits for its trigger, an
observation from a real run, before it is built. Each improvement has a stable
ID for reference.

## Guarding against a false clean

| ID | Improvement | Add when |
| --- | --- | --- |
| C21 | Pass the previous report to the next verifier, which must confirm each earlier issue resolved while still running the full procedure. | A run reaches `clean` while an earlier finding is still present. |
| C18 | A check helper script, shipped in the skill directory, that workers on both hosts run for tests, `openspec validate --strict` and configured checks, copying its compact summary into their reply. The summary is still relayed by the model. | A run reaches `clean` with failing or unrun tests, or misreports a test result. |
| C27 | A full report parser: finding IDs, per-finding dispositions, contradiction detection. | A verifier writes `VERDICT: CLEAN` while its report lists issues and the current count check misses it. |
| C30 | An evidence ledger compared with the files at the end of the run, so that check results no longer depend on the model relaying them. | Check results relayed by a worker are found altered. |
| C32 | A before/after snapshot that detects edits during verification or a changed HEAD. | Verifiers edit files through the shell despite the prompt rule, or a worker commits despite the no-commit rule. |

## Fixers

| ID | Improvement | Add when |
| --- | --- | --- |
| C11 | Let the fixer explain why a finding is wrong instead of changing code; the next verifier judges it. | A fixer bends code to satisfy a wrong finding. |
| C28 | A structured fixer report (schema) with one decision per finding. | Fixers routinely skip findings silently. |

## Workers that wait or misbehave

| ID | Improvement | Add when |
| --- | --- | --- |
| C08 | bb: a server-entry command that reads the starting thread's permission mode and refuses `accept-edits`. OpenCode: notify the starting session of a worker's permission request and keep polling instead of ending the run. | A run starts from an unsupported mode and stalls, or ending on a permission request costs a run the user would have approved. |
| C40 | bb: a stall detector that finds a running call's worker thread and polls `bb thread interactions list`; a pending request stops the run. Needs a background service in the bb server entry. | An `auto` or `full` worker stalls on an approval request in a real run. |
| C41 | A worker scope rule in the shared prompt rules: stay inside the checkout, do not search the filesystem or other repositories, never set `BB_*` variables or act as another thread. It instructs; it does not enforce. | A worker changes anything outside the checkout, or acts as another bb thread with a command that changes state (so far only read-only commands were seen; see known issues). |
| C14 | bb: refuse a start while a `queued` or `running` run exists on the same environment. | Two bb loops run in one checkout. |
| C25 | A per-run time limit (needs per-host code, since workflow scripts have no clock). | Runs stall in ways the round limit does not catch. |

## Reporting

| ID | Improvement | Add when |
| --- | --- | --- |
| C09 | bb: page `bb workflows history` into thread storage and link each round's report. OpenCode: one file per round. | Users cannot find an earlier round's report from the preview or the worker sessions. |
| C16 | Failure context in the result: round, role, error, possible partial edits. | Users cannot tell where a failed run stopped from the host's native error. |
| C37 | Per-stage progress counts. | Users cannot tell what a failed run did from the round reports and failure context. |
| C23 | Status of a running loop: native `bb workflows status` on bb, a tool action on OpenCode. | Users need progress beyond the preview and worker sessions. |

## Loop control

| ID | Improvement | Add when |
| --- | --- | --- |
| C20 | Stop early when the same issues repeat in consecutive rounds, by comparing normalized issue sections. | Runs regularly spend their remaining rounds on unchanged issues. |
| C19 | OpenCode: resume after a host restart by saving each `agent()` call before submitting and replaying completed calls, reconciling the pending one without resubmitting. bb already recovers natively. | OpenCode restarts or updates interrupt real runs. |
| C26 | Crash-safe ownership: checkout lock with tokens, unload fencing, receipts. | A crash leaves an orphaned worker that edits the checkout, or cleanup overwrites a newer run's result. |

## Environment and setup

| ID | Improvement | Add when |
| --- | --- | --- |
| C33 | Detect conflicting copies of the verify skill. | A run uses the wrong copy of the verify skill. |
| C36 | bb: model-catalogue preflight with a wait. | Local Flint or another provider fails on stale catalogue data. |
| C31 | Browser observation records for UI changes. | UI changes reach `clean` without anyone looking at the UI. |
| C22, C34 | Navigation guidance in prompts, or a computed context map. | Retrieval cost dominates run time. |
