---
name: openspec-verify-loop
description: Run iterative OpenSpec verification and fixes until every critical issue, warning, suggestion, and applicable unverified check is resolved. Use for /verify-loop and explicit OpenSpec verify/fix loops; use openspec-verify-change for a one-pass review.
compatibility: Native openspec-verify-loop plugin on OpenCode 2.2.5, OpenSpec 1.16.0, and a repo-local OpenSpec change in a Git checkout.
---

Call the installed `openspec_verify_loop` tool directly. The plugin owns the loop
and creates fresh sequential verifier/fixer sessions. Its result includes the
run ID and saved report directory; report them immediately.

Workers inherit the invoking turn's model and variant unless explicit role model
options override them. The selection is pinned across rounds and resume. If it
cannot be identified or is unavailable, report the blocker; do not switch to a
default model. Start/status results include the selected worker models.

- Start: `{ "action": "run" }`, optionally with `"change": "name"`.
- Inspect: `{ "action": "status" }`, optionally with `"runId": "run_..."`.
- Resume: `{ "action": "resume", "runId": "run_..." }`.
- Stop: `{ "action": "stop", "runId": "run_..." }`.

Use the explicitly requested change, or one clearly identified in conversation.
Otherwise omit `change`; exactly one active change is selected automatically.
For `selection_required`, present every returned candidate and ask for a choice.
For `no_active_change`, report that there is nothing to verify. Never choose by
recency or change completion percentage.

Work continues in the server after start returns. Use status when requested;
do not run a second loop or manually reproduce worker sequencing. Final session
notices report completion. Read saved reports when the user needs details.

For `awaiting_input`, show the exact worker session and pending permission or
question. The user answers there, then explicitly resumes. Never grant approval
or replace a waiting worker yourself. For `stopping`, inspect status until
termination is confirmed before starting another run. Changed requirements,
procedure, worker policy, or configuration need review and a new run.

Only `clean` means a fresh full verifier found zero findings at every severity,
with evidenced prior resolutions and passing applicable checks. Report blockers,
failures, interruption, and limits accurately. Do not commit, archive, sync specs,
push, merge, deploy, change model/provider settings, or install prerequisites.

If the management tool is absent, report that the native plugin must be installed;
do not search for runtime bundles or invent shell launch commands. Report contracts
are described in [references/report-contract.md](references/report-contract.md).
