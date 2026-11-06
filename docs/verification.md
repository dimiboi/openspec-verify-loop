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
  `Not verified`, emphasis/code marks around positive critical/warning/suggestion
  counts in both CLEAN and UNVERIFIED reports, emphasized zero counts staying
  clean and emphasized counts before the Final Assessment being ignored,
  the `unverified` stop (also on the last round),
  `VERDICT: UNVERIFIED` contradicted by a severity count or by no `Not verified`
  check, Design Adherence marked Not applicable for a missing `design.md` not blocking
  clean, a Final Assessment deciding clean and unverified while earlier
  sections quote counts and marks, and without a Final Assessment a
  double-quoted `Not verified` not blocking clean while a backticked one and a
  quoted count still do, `VERDICT: ISSUES` with only a `Not verified` check going to the fixer,
  change and store pass-through, the change name from round 1's
  report title, a missing title, the worker rules per role (including the no-loop rule for every worker, the checkout no-edit rule with its
  temporary-file allowance and the absent-design rule for verifiers only), and the loader
  rejecting `Date`, `Math.random` and `process`.
- **Runner** (`tests/runner.test.ts`): `agent()` over the real session adapter
  with a fake client. Covers one submission, a lost response reconciled without
  resubmitting, an invisible submission failing with its submission error, a
  failed read before submission keeping its cause with no prompt sent, a lost
  creation response reconciled without a second session, a failed creation
  sending no prompt, a permission request that
  interrupts and names the session, failed observation cleanup, a permission
  wait whose cleanup fails while retaining its worker and original cause,
  abort, and per-role permissions. Uncertain admission is cleaned up without
  a second submission. Deferred responses cover stop during session creation,
  final observation and a lost admission response; no prompt is sent after
  cancellation is discovered and cleanup waits for admission reconciliation.
- **Manager** (`tests/manager.test.ts`): one run per checkout, stop, plugin
  dispose interrupting active workers, and one notice per run. False or thrown
  cleanup failures retain the checkout until an explicit retry succeeds;
  concurrent stops and close share one in-flight cleanup attempt, and no
  background retry or prompt submission occurs. Cancellation wins before
  terminal result commitment, close retries retained failed workers, and close
  waits for an already pending failure notice before disposal or retry reporting.
  A result left by unload is recovered and delivered by another instance.
- **Plugin** (`tests/plugin.test.ts`, `tests/opencode.test.ts`): command
  parsing, options (invalid ones fail loading), registrations and disposal, the invoking model after a
  session model switch, unavailable models, missing and duplicate verify skills,
  worker rejection, tool input with unknown or misplaced fields or a bad round
  limit refused before approval, tool-less reporting turns, the host endpoint
  check, a hosting server with another process, creation time, directory or
  metadata, no discoverable service, a server reporting another version, and
  session-adapter reconciliation. Input other than the loop prompt, or the
  prompt's identity with other text, fails before submission; an interrupted
  outcome is reported as interrupted; a repeated message cursor or a
  transcript over 20,000 messages fails collection. Adapter interruption still runs after an
  inbox request fails; confirmation rejects unresolved inbox/cancel errors,
  queued input, active or busy execution, while a missing session is inactive.
  Commands and tools answer every explicit cleanup retry without another
  terminal run notice. Failed plugin unload keeps controls and replies available
  and permits a successful cleanup retry before disposing registrations once.
- **bb server entry** (`tests/bb-server.test.ts`): the agent configuration
  hides the skill from Workflows workers, keeps it for other origins, always
  returns `tools`, and names the skill as its frontmatter does.
- **Project context** (`tests/context.test.ts`): temporary Git/OpenSpec fixtures
  cover nested directories, root-plus-subpath, nested-plus-subpath and symlink
  aliases. Discovery and workers use the nested project, while sibling and alias
  starts share the canonical checkout reservation and sibling stops keep the
  original worker directory. Nested Git checkout fixtures verify direct and
  root-plus-subpath sessions share the effective checkout's reservation for
  active runs, failed cleanup and explicit stop retries in both directions.
  Adapter fixtures retain model/metadata/permission mismatch rejection for
  every directory representation. A directory outside any Git checkout is
  refused as blocked.
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
7. During a run, compare the staged catalogs in
   `~/.bb/runtime/global-skills/*/catalog.json` that the run created. Confirm
   that worker catalogs (those without the `workflows` skill) do not list
   `openspec-verify-loop`, and that a new user thread still lists it.

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

6. In an isolated nested Git project, create a worker through the adapter using
   the invoking subdirectory. Read the native session's location/subpath and
   confirm the effective directory and nearest OpenSpec root remain nested.
   OpenCode 2.2.5 can return an already nested location with a subpath relative
   to the Git root; do not append that subpath to the nested location again.
7. Exercise a rejected interruption through an isolated test plugin/adapter,
   then stop again. Confirm failure retains the reservation and worker identity,
   another start is refused, and a successful retry replies without another
   terminal notice. Unload with an active worker and with retained failed cleanup;
   record whether the host honors or ignores rejection of the cleanup callback.
   Remove the isolated project's plugin configuration to invoke native unload,
   keeping a test-only wrapper log of callback start/success/rejection. Scoped
   cache eviction can return while a worker is still active and is not proof
   that plugin cleanup finished. Do not reload all loaded locations or manage
   the OpenCode service for this check.

## Recorded results

### Hardening checks (2026-11-04)

Native directory round-trip on the existing OpenCode 2.2.5 host (PID 84809), in
the isolated Git fixture `verify-loop-hardening-native-J2XlVq/packages/app`:

- Worker `ses_1a1a799ff72da6a28b1315941a89d3b89de1f32140e`, assignment
  `run_1a1a799ff72cb56d6240d8d44d7a376f5228f9e8668`, created through the updated
  adapter at 17:27 UTC. Native creation and repeated identity validation passed.
- Both `location.directory` and the effective directory remained the nested
  `packages/app`; native `subpath` was `packages/app`, relative to the Git root.
  `openspec list --json` from the effective directory found that nested root
  and the `add-app` fixture change.
- The worker used the configured `lmstudio/recursivesi/flint` model reference
  for session creation. No prompt or model request was submitted in this path
  check. Interruption was confirmed and the empty test session was removed.

The audit's fake-adapter probes and this empty-session round-trip are not
evidence for active-worker stop or native plugin unload behavior. Those checks
are recorded separately when executed.

Active-worker checks used the existing OpenCode 2.2.5 host and the configured
`lmstudio/recursivesi/flint#default` model in the isolated
`verify-loop-native-lifecycle-ioWa2G/packages/app` fixture at 17:34 UTC. A local
test plugin delegates to the updated plugin setup and real host adapter; a
fixture marker injects interruption failure without modifying the production
adapter. Notices were inspected in both delivered context and queued inbox
items, since reporting turns can leave later notices queued.

| Check | Run and worker | Outcome |
| --- | --- | --- |
| Normal stop | `run_1a1a7a042f710b094abea6e465ca3796933d57f48f8`, `ses_1a1a7a042f9c4ec2beadd854bf097c6561318f34a0f` | Active worker interrupted; one terminal notice says stopped. |
| Failed stop and explicit retry | `run_1a1a7a044471e667a5eaca141eb8a0be4201124351e`, `ses_1a1a7a04447b2954c42007147ffb6d407c20bfc0ea9` | Injected interruption error produced a failed notice identifying the worker and retained reservation; another start was blocked; removing the marker and stopping again returned stopped without a second terminal notice. |

Native plugin unload was exercised by removing only the isolated project's
plugin configuration in `verify-loop-native-unload-uJoSP5/app`, with a
test-only wrapper recording the real cleanup callback. The same host/model
was used; no global reload or service operation was performed.

| Check | Date and run | Outcome |
| --- | --- | --- |
| Normal native unload | 2026-11-04 17:37 UTC, `run_1a1a7a308bac65d7a204e724d8884518f7142980a1a`, worker `ses_1a1a7a308ba0ee88d3b360c4718bc18ef17e9c3a034` | Callback logged start, real interruption and success; the worker was interrupted/inactive when cleanup finished. |
| Rejected native unload | 2026-11-04 17:39 UTC, `run_1a1a7a4ab7aa3baaac4f1b4491bb9f2157e4c6e2966`, worker `ses_1a1a7a4ab7a14babdca2dfd4fb198632e82d03a395b` | Injected interruption failure made the real callback reject. Before direct test cleanup, the worker remained active, but OpenCode removed the plugin and stop command; an explicit retry returned CommandNotFoundError. The test then interrupted the worker with native session controls and waited for inactivity. |

This failure case verifies the plugin's rejection and exposes an upstream
limit, rather than proving the host preserves cleanup controls. See
[the known issue](known-issues.md#plugin-unload-discards-controls-after-cleanup-rejects).

The exact shared script passed `bb workflows validate --script --json` on
2026-11-04: `valid: true`, 7377 source bytes, no literal model selections. This
validated the script without starting a workflow. `npm ci` and `npm run check`
passed on Node 26.13.0 with 88 deterministic tests, type checking, bundle
generation and package validation; that suite used no live host or model.

After the reservation-key follow-up on 2026-11-04, `npm ci` and `npm run check`
passed on Node 26.13.0 with 90 deterministic tests, type checking, bundle
generation and package validation. Both new nested Git checkout cases failed
against the earlier implementation and passed with the reservation derived
from the effective directory for start and stop. These checks used fake
adapters only; no native session or model request was started.

### Earlier host checks

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
| Workflow validation (`hide-loop-skill-from-bb-workers` task 3.2) | 2026-11-04 | bb 0.48.1 | `hide-loop-skill-from-bb-workers`, uncommitted on `a9919cd` | `bb workflows validate --script --json` | `"valid": true` (7509 bytes), `literalSelections: []` |
| bb, hidden skill (`hide-loop-skill-from-bb-workers` task 3.3) | 2026-11-04 | bb 0.48.1, `claude-sonnet-5-5`, medium, `auto`, sandbox worktree | `hide-loop-skill-from-bb-workers`, uncommitted on `a9919cd`, installed from the worktree path | `wfr_be7980a5-6eb5-4593-9780-1c23605c85b8` on `add-greeting`, started from sub-thread `thr_ig22kysmsj` | `clean` after 2 verifications and 1 fix. The worker catalog `32eab9bc` (no `workflows` skill) did not list `openspec-verify-loop`; the user thread's catalog `ea96d041` did. Only the three workers ran, and none ran `bb workflows` or `bb_workflow_run`; bb-openspec's `verify-fix-loop` stayed visible to workers |
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
