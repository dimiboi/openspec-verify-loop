---
name: openspec-verify-loop
description: Verify an OpenSpec change, fix every finding with fresh workers, and repeat until a fresh verification is clean. Use for /opsx-verify-loop and explicit OpenSpec verify/fix loops; use openspec-verify-change for a one-pass review.
compatibility: Native openspec-verify-loop plugin on OpenCode 2.2.5 with the project's openspec-verify-change skill.
---

Call the installed `openspec_verify_loop` tool directly. The plugin runs the loop
in the background: each round a fresh verifier runs the project's
`openspec-verify-change` procedure, and when it finds issues a fresh fixer fixes
them all. Workers use this turn's model and variant.

- Start: `{ "action": "run" }`, optionally with `"change": "name"`,
  `"store": "id"` and `"maxRounds": n` (default 5).
- Stop: `{ "action": "stop" }` interrupts the active worker and ends the run.

Pass a change the user named, or one clearly identified in the conversation.
Otherwise omit `change`; the first verifier selects the only active change, and
the run ends `blocked` with the list of changes when several are active. Pass a
store only when the user gave one.

`run` returns `started` with the run ID and worker model. Report that and end the
turn; do not start a second run or do the verification yourself. The result
arrives later as a session notice with `status` (`clean`, `unverified`, `limit`,
`blocked`, `failed` or `stopped`), the change, the number of verifications, a
reason and the last report. Only `clean` means a fresh verification found no
issues and verified every check. `unverified` means it found no issues but left
checks Not verified; whether to archive is the user's call.

If a worker waits for a permission or question, the run ends `blocked` and names
the worker session. Do not approve requests on its behalf.

Do not commit, archive, sync specs, push, merge, or deploy as part of the loop.
If the `openspec_verify_loop` tool is absent, report that the plugin must be
installed.
