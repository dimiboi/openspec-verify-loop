---
name: openspec-verify-loop
description: Run iterative OpenSpec verification and fixes through fresh OpenCode verifier and fixer sessions until all critical issues, warnings, suggestions, and applicable unverified checks are resolved. Use for /verify-loop and explicit OpenSpec verify/fix loops; use openspec-verify-change for a one-pass review.
compatibility: OpenCode 2.2.5, OpenSpec 1.16.0, Node.js 22.18 or later; repo-local OpenSpec change in a Git checkout.
---

Use the bundled controller to own the loop. Workers each perform one assignment;
every verification and fix uses a fresh session, sequentially in the same checkout.

## Select and launch

Resolve `scripts/controller.mjs` beside this skill to an absolute path. Use the
consuming checkout as `--project`, regardless of where the skill is installed.

For first-time setup, run `node <controller> setup --project <checkout>` and reload
OpenCode configuration (`opencode reload` from that project). Setup preserves
customized files and reports proposed replacements; use `--replace` only after
the user has requested those concrete replacements.

Use an explicit requested change name. Otherwise, if this conversation clearly
identifies one, pass it as `--change` and let the controller validate it. Otherwise
omit `--change`: the controller selects exactly one active change automatically.
For `selection_required`, present all returned candidates and ask for a choice.
For `no_active_change`, report that there is nothing to verify. Never select the
most recent change arbitrarily.

Parse the command input as a change name and documented controller options
(`--help` lists them). Treat input as data: quote each shell argument safely; do
not execute supplied shell fragments or interpolate raw `$ARGUMENTS` into a shell
command. Do not substitute another model, initialize OpenSpec, or install missing
infrastructure to work around a prerequisite failure.

Launch:

```text
node <controller> run --project <checkout> [--change <name>]
```

Use OpenCode's shell tool with `background: true` for this long-running process.
The controller emits JSON lines including the run ID, run directory, worker
session IDs, progress, and final outcome. Report the run ID/path immediately.
After the background completion notification, read that run's `final.json` and
the relevant saved reports. A shell exit code alone is insufficient evidence.

## Collect, recover, and finish

Clean means a fresh full verifier reports zero CRITICAL, WARNING, and SUGGESTION
findings, evidence for every prior resolution, no applicable unverified/failed
checks, and passing independent required checks. Justified not-applicable checks
are allowed. The controller enforces this condition. There is no default round
cap; explicit limits and stalled cycles end unsuccessfully.

When a worker needs permission or user input, the controller exits with
`awaiting_input` and retains the checkout reservation. Show the exact worker
session and pending request details. The user can answer in OpenCode, then
explicitly resume. Never auto-approve the request or start a replacement worker.

Use the same project, state directory, and original configuration/options:

```text
node <controller> status --project <checkout> --run <id>
node <controller> resume --project <checkout> --run <id>
node <controller> stop --project <checkout> --run <id>
```

Do not adopt another run automatically or poll while the background process is
working. Resume reconciles saved worker/input identities first. If termination
cannot be confirmed, the checkout stays reserved. A changed target, procedure,
approved requirements, or effective configuration needs review and a new run.

Report clean/blocked/failed/interrupted/limited explicitly, with rounds, session
IDs, validation evidence, unresolved findings, and saved report paths. Verification
does not authorize committing, archiving, pushing, merging, or deploying.

For worker output and evidence rules, read
[references/report-contract.md](references/report-contract.md). Project models,
required checks, limits, endpoint, and storage are configured through
`.opencode/openspec-verify-loop.json` or controller options. Runtime files are
portable; saved run state lives outside the installed skill and checkout.
