# Verification

## Automated checks

```sh
npm ci
npm run check
```

The suite checks types, builds `dist/index.js`, runs the tests and validates the
package. Tests use fake host and worker adapters; no model request, OpenCode
session or bb workflow is started.

- **Loop script** (`tests/loop.test.ts`): the shared script runs through the
  OpenCode loader with a fake `agent()`. Covers clean on round 1, fix then
  clean, the round limit with no trailing fixer, a small call budget, blocked
  verifiers and fixers (with a reason, a colon, or none), emphasis and a
  trailing period around a verdict, an unrecognized verifier result blocking
  without a fixer (also on the last round), a fixer reply with no verdict,
  `VERDICT: CLEAN` contradicted by a severity count or
  `Not verified`, the `unverified` stop (also on the last round),
  `VERDICT: UNVERIFIED` contradicted by a severity count or by no `Not verified`
  check, Design Adherence marked Not applicable for a missing `design.md` not blocking
  clean, a Final Assessment deciding clean and unverified while earlier
  sections quote counts and marks, and without a Final Assessment a
  double-quoted `Not verified` not blocking clean while a backticked one and a
  quoted count still do, `VERDICT: ISSUES` with only a `Not verified` check going to the fixer,
  change and store pass-through, the change name from round 1's
  report title, a missing title, the worker rules per role (including the checkout no-edit rule with its
  temporary-file allowance and the absent-design rule for verifiers only), and the loader
  rejecting `Date`, `Math.random` and `process`.
- **Runner** (`tests/runner.test.ts`): `agent()` over the real session adapter
  with a fake client. Covers one submission, a lost response reconciled without
  resubmitting, an invisible submission failing, a permission request that
  interrupts and names the session, abort, and per-role permissions.
- **Manager** (`tests/manager.test.ts`): one run per checkout, stop, plugin
  dispose interrupting active workers, and one notice per run.
- **Plugin** (`tests/plugin.test.ts`, `tests/opencode.test.ts`): command
  parsing, options, registrations and disposal, the invoking model after a
  session model switch, unavailable models, missing and duplicate verify skills,
  worker rejection, tool-less reporting turns, the host endpoint check, and
  session-adapter reconciliation.
- **Packaging** (`tests/package.test.ts`, `scripts/validate-plugin.mjs`): npm's
  resolver against a local Git fixture reproduces the preparation failure a
  `build` script causes, then confirms the package ships `dist/index.js`,
  `bb/server.ts`, both skills and the loop script without starting child npm.
  The validator checks the bb manifest and both skill texts.

## Manual checks

The automated suite does not show that host loading, notices or model behaviour
work. Use an isolated Git project with an active OpenSpec change that has known
issues, and the project's `openspec-verify-change` skill. Read
[known upstream issues](known-issues.md) first: several entries change how a
manual run has to be set up, such as the custom ACP profile local Flint needs on
bb and the `opencode reload` a new OpenCode folder needs.

### Workflow validation (bb CLI)

```sh
bb workflows validate --script "$(cat skills/openspec-verify-loop/verify-loop.js)"
```

It must report `"valid": true`. The OpenCode loader only mirrors the sandbox
restrictions seen so far; bb's validator is the authority.

### bb

1. Install this repository with `bb plugin install` and enable the Workflows
   plugin. Confirm the `openspec-verify-loop` skill is
   listed and no workflow starts.
2. From a Claude thread in `auto` mode, run `/openspec-verify-loop <change>`.
   Confirm that exactly one `::workflow-preview` line is posted and the turn
   ends.
3. In the preview, confirm that workers use the thread's model and reasoning,
   and that a fixer runs after a verification with issues and is followed by a
   fresh verification.
4. When the run ends `clean`, `unverified` or `limit`, confirm that the thread reports the
   status, change, round count, reason and run ID from the completion notice,
   and starts no new workflow.
5. Start a second run, ask the thread to stop it, and confirm it runs
   `bb workflows stop <runId>` and reports the stopped status.
6. Repeat step 2 from a local Flint thread in `full` mode on the
   `acp-opencode-default-compat` profile (see the README's ACP section), picking
   the skill from the `/` menu or naming it in the prompt. Confirm that workers
   run on Flint and the run reaches a verdict.

### OpenCode 2.2.5

1. Install the plugin from Git (or point a project's plugin entry at this
   checkout and run `npm run bundle`). Confirm `/opsx-verify-loop`,
   `/opsx-verify-loop-stop`, the `openspec_verify_loop` tool and the skill are
   available.
2. Select a model other than the server default, then run
   `/opsx-verify-loop <change>`. Confirm the start result names that model, each
   worker session uses it, and verifier and fixer sessions alternate.
3. Confirm the final notice reports the result and the reporting turn cannot
   use tools, while an ordinary later turn keeps its tools.
4. Start another run and use `/opsx-verify-loop-stop` during a worker. Confirm the
   worker session is interrupted and the notice reports `stopped`.
5. From a worker session, run `/opsx-verify-loop <change>` (or call
   `openspec_verify_loop`). Confirm the result is `blocked` with "Loop workers
   cannot invoke the loop management interface" and no session is created.

## Recorded results

Manual runs for the `unified-verify-loop-mvp` change, against a sandbox repository
whose `add-greeting` change had two known defects (wrong greeting format and a
missing default greeting, with a failing test). After the earlier runs, the loop
script gained the recorded-manual-check prompt rule, a clean rule that counts
`Not verified` only where a report marks a check, and the `unverified` stop.
None of these alters what the host runs exercised: worker creation and model
inheritance, one submission per worker, previews and notices, stop, worker
refusal and tool-less reporting. Rounds and worker calls are unchanged, and the
clean rule only accepts more reports than before, so the `clean` outcomes still
hold. The last two rows ran the `unverified` stop and the fixer's
no-optional-artifacts rule on bb.

`--store` has not been exercised on a real host. The loop test "a given change
and store reach every prompt unchanged" covers it in the script, and
`scripts/validate-plugin.mjs` checks that the bb skill passes it through.

The OpenCode commands were renamed from `/verify-loop` and `/verify-loop-stop`
to `/opsx-verify-loop` and `/opsx-verify-loop-stop` after the runs. The rows keep
the names the runs used; the renamed-commands row checks the new names.

| Check | Date | Host and settings | Plugin | Run | Outcome |
| --- | --- | --- | --- | --- | --- |
| Automated suite (task 4.1) | 2026-11-04 | Node 26.13.0, macOS | this change, after the `src/util.ts` trim | `npm run check` | exits 0; 49 of 49 tests pass; `dist/index.js` regenerated |
| Workflow validation (task 4.2) | 2026-11-04 | bb 0.48.1 | this change; script unchanged since the `unverified` status | `bb workflows validate --script` | `"valid": true` (5566 bytes) |
| Workflow validation (`block-unrecognized-verdicts` task 2.2) | 2026-11-04 | bb 0.48.1 | `block-unrecognized-verdicts`, uncommitted on `d75a895` | `bb workflows validate --script --json` | `"valid": true` (6019 bytes), `literalSelections: []`; the en and em dash in the blocked pattern are accepted |
| Workflow validation (`pass-absent-optional-design` task 2.2) | 2026-11-04 | bb 0.48.1 | `pass-absent-optional-design` on top of `block-unrecognized-verdicts`, uncommitted on `d75a895` | `bb workflows validate --script --json` | `"valid": true` (6284 bytes), `literalSelections: []` |
| Workflow validation (`ignore-quoted-not-verified` task 3.2) | 2026-11-04 | bb 0.48.1 | `ignore-quoted-not-verified`, with the Final Assessment rule, on top of the two changes above, uncommitted on `d75a895` | `bb workflows validate --script --json` | `"valid": true` (7188 bytes), `literalSelections: []` |
| Workflow validation (`verifier-temp-files` task 2.2) | 2026-11-04 | bb 0.48.1 | `verifier-temp-files`, uncommitted on `3e3561c` | `bb workflows validate --script --json` | `"valid": true` (7321 bytes), `literalSelections: []` |
| bb, Claude (task 4.3) | 2026-11-02 | bb 0.48.1, `claude-sonnet-5-5`, medium, `auto` | `ffdf462` + `67c4e13` | `wfr_a1ec773a-5fba-4c08-befd-b81c62a26593` | `clean` after 3 verifications; all 5 workers inherited the thread's model, reasoning and mode; one preview; the completion report started no run |
| bb stop (task 4.3) | 2026-11-02 | same thread | same | `wfr_ebfc225d-d798-4eba-beb4-758376265d7e` | `bb workflows stop` from the thread; run cancelled; no relaunch; started as `/openspec-verify-loop add-greeting --max-rounds 2`, whose arguments file held `{"change": "add-greeting", "maxRounds": 2, …}` |
| bb, local Flint (task 4.4) | 2026-11-03 | bb 0.48.1, `acp-opencode-default-compat`, `lmstudio/recursivesi/flint`, medium, `full` | `f0ecef7` | `wfr_e055674e-5a28-4802-ba50-e9db7644cb2e` | `clean` after 2 verifications; workers on Flint; the completion report started no run |
| OpenCode, tool (task 4.5) | 2026-11-03 | OpenCode 2.2.5, `lmstudio/recursivesi/flint#default`, plugin loaded from the checkout path | `2a98c37` | `run_1a19ec73d8e4d4e2ae6c72d49e0b45d234b185d5988` | `clean` after 2 verifications; verifier sessions denied `edit`; one result notice; the reporting turn used no tools |
| OpenCode, commands (task 4.5) | 2026-11-03 | same | `e5b3a93` | `run_1a19eed1eb60efa30cb9b0f4579b07adaaaf31bda20` | `/verify-loop` started with the session's model; `/verify-loop-stop` during fixer 1 left it `interrupted`, started no further worker, and the session received two notices (`started`, `stopped`); reporting turns used no tools |
| OpenCode, worker refusal (step 5) | 2026-11-03 | same | `e5b3a93` | worker session of the run above | `/verify-loop` from the worker returned `blocked` with "Loop workers cannot invoke the loop management interface"; no session created |
| OpenCode, renamed commands (task 2.8) | 2026-11-03 | OpenCode 2.2.5, plugin loaded from the checkout path | this change, renamed commands | `opencode reload`; `/opsx-verify-loop-stop` with no run; `/opsx-verify-loop` from a worker session | only `opsx-verify-loop` and `opsx-verify-loop-stop` registered; stop returned `not_running`; the worker's start returned `blocked`; no worker session created |
| bb, `unverified` stop (task 1.8) | 2026-11-03 | bb 0.48.1, `claude-opus-5-5`, medium, `auto`, worktree | this change, with the `unverified` status, applied as an uncommitted patch on `d6fecf2` | `wfr_5785aa5d-a6a4-49ef-a8f3-c1672af8a164` on a throwaway change `add-greeting-check` with no `design.md` and one failing test | `unverified` after 2 verifications: verifier 1 found 2 warnings, fixer 1 fixed only the code and created no `design.md`, verifier 2 found no issues with Design Adherence Not verified and ended `VERDICT: UNVERIFIED`; the change was deleted afterwards |
| bb, narrowed staleness rule (task 1.9) | 2026-11-03 | same | same | `wfr_008002d5-9f5c-4300-bd73-9c9c48229d91` on `unified-verify-loop-mvp` | `clean` after 1 verification, no fixer; the verifier accepted every recorded host run above as verified because the later changes do not alter the behaviour those runs exercised |

The Git install in task 4.5 was waived until the branch is pushed; the plugin was
loaded from the checkout path instead.
