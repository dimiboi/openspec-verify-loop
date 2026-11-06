---
name: openspec-verify-loop
description: Run the installed openspec-verify-change procedure, fix every finding with a fresh worker, and repeat until a fresh verification is clean, as a bb workflow using this thread's model. Use for /openspec-verify-loop or an explicit iterative OpenSpec verify/fix request, not a one-pass review. A completion notice only reports; it never starts another run.
---

# OpenSpec verification loop

This skill starts one bb workflow that runs `verify-loop.js`, next to this file.
Each round a fresh verifier runs the `openspec-verify-change` procedure; when it
finds issues, a fresh fixer receives the full report and fixes everything. The
loop ends `clean`, `unverified`, `blocked`, or at the round limit (`limit`,
default 5).
Workers inherit this thread's provider, model, reasoning and permission mode.

## Precondition

Start only from a thread in `auto` or `full` mode. Workers are hidden threads,
so a mode that asks before shell commands, such as `accept-edits`, stalls them
on the first approval. ACP providers such as local Flint offer only
`accept-edits` and `full`, so they need `full`. The Workflows plugin must be
enabled (`bb plugin enable workflows`).

Choosing the mode is the user's job. You cannot read your own permission mode,
so do not try: do not look through `bb` settings, guides or thread options for
it. State the requirement once in your reply after launching.

## Start

Usage: `/openspec-verify-loop [change] [--store <id>] [--max-rounds <n>]`.
Launch at once. Run only the commands in the steps below. Do not inspect the
change, the repository or `bb` itself, run the verification yourself, or choose
a change for the user.

1. Find the absolute path of `openspec-verify-change/SKILL.md` in your skill
   list. If it is not there, run `bb skill list --json` and take the
   `filePath` of a skill named `openspec-verify-change`, preferring one inside
   this checkout. If none exists, report that the OpenSpec verify workflow must
   be installed and stop.
2. Write the arguments as JSON to thread storage. Include `change`, `store` and
   `maxRounds` (a number) only when the user gave them, unchanged:

   ```sh
   cat > "$BB_THREAD_STORAGE/verify-loop-args.json" <<'EOF'
   {"change": "add-export", "store": "team-specs", "maxRounds": 5, "procedurePath": "/abs/path/openspec-verify-change/SKILL.md"}
   EOF
   ```

3. Start the workflow, where `<dir>` is the directory containing this
   `SKILL.md`:

   ```sh
   bb workflows run --script "$(cat "<dir>/verify-loop.js")" --args "$(cat "$BB_THREAD_STORAGE/verify-loop-args.json")" --json
   ```

   If the command fails, report its error and stop. Do not retry it or start
   the workflow another way.

4. The command returns `{runId, name, status}`. Post this line once, on its
   own, with the returned run ID, then end the turn without waiting:

   ::workflow-preview{run="<runId>"}

Without a change, the first verifier selects the only active change. When
several are active it ends `blocked` and lists them; ask the user to pick one.

## Completion

The workflow's completion notice carries the result:
`{status, change, rounds, reason, report}`. Report the status, change, number
of verifications, reason and run ID, and summarize the remaining issues from
`report` unless the status is `clean`. Only `clean` means a fresh verification
found no issues and verified every check. For `unverified`, list the checks the
report marks Not verified and say that whether to archive is the user's call.
If the notice omits or truncates the result, read it with
`bb workflows status <runId>`, or point the user to the workflow preview.

A completion notice never authorizes another run. Do not start, resume or stop
a workflow in response to it, and do not fix the remaining issues yourself
unless the user asks.

## Stop

When the user asks to stop the loop, run `bb workflows stop <runId>` and report
the status it returns.
