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

## Live fixture and independent checks

The opt-in live harness uses `tests/live/fixtures/greeting/`. It contains a
small ES module and an active `add-greeting` change, with wrong greeting
punctuation, no default greeting, and a failing `node --test` check. Task
markers claim the feature is complete, so verification must inspect behavior.
The optional `design.md` is intentionally absent.

Each attempt copies the seed into a fresh Git checkout outside this plugin's
source tree. Supply the installed `openspec-verify-change/SKILL.md`; the harness
copies that procedure's directory and relative resources into one fixture skill
location and records its original path and content hashes. It uses the actual
installed procedure rather than a replacement verifier. The seed stays unchanged
for the next attempt.

The controller independently checks `greet('Ada')`, `greet('')` and `greet()`
against the original requirements, runs the fixture tests, and confirms that
`design.md` remains absent. Its assertions, collected evidence and any plugin
snapshot live outside the worker's checkout. Editing fixture tests cannot
change those expectations. These directories do not constitute a filesystem
sandbox: workers retain the selected host's filesystem permissions.

### Attempt lifecycle and evidence

Live commands take finite `--timeout` and `--cleanup-timeout` values in seconds
(defaults: 3600 and 60). Each invocation makes one attempt. A lost start response
is observed through its known origin rather than retried. A model that ends
`blocked`, `unverified` or `limit` has not passed fix-to-clean; those results are
kept separately from setup, observation and assertion failures. A stop racing
with natural completion is `not_exercised` and exits nonzero.

The printed attempt directory contains `fixture/`, OpenCode's `plugin/`
snapshot when applicable, and `evidence/`. `result.json` records settings,
source/procedure hashes, host versions, run and worker identities, terminal
results, individual assertions and cleanup state. `summary.md` links that
result; adjacent JSONL files retain complete collected native records. Missing
or bounded-out evidence is explicit. Authentication headers and credentials are
excluded from recorded host metadata.

Timeout, errors and catchable SIGINT/SIGTERM enter bounded cleanup. Public stop
controls are preferred; emergency native interruption is recorded separately
and cannot pass the normal stop scenario. Exit zero requires both a scenario
pass and confirmed inactivity. Files, projects, threads and native sessions
remain available for inspection and later manual removal. If cleanup is
unconfirmed, use the reported native worker identities to stop them and confirm
inactivity before removing their fixture. SIGKILL or a host crash can require
the same manual recovery.

## Manual checks

The automated suite does not show that host loading, notices or model behaviour
work. Use an isolated Git project with an active OpenSpec change that has known
issues, and the project's `openspec-verify-change` skill. Read
[known upstream issues](known-issues.md) first: several entries change how a
manual run has to be set up, such as how to start the skill on an ACP provider
and waiting for a new OpenCode location's catalogue. A global `opencode reload`
is unnecessary and would affect other loaded locations.

### OpenCode live commands

Run `npm ci` and `npm run check` first, on Node >=22.18. The driver snapshots the
published plugin resources and resolves production dependencies beside them with
`npm ci --omit=dev --ignore-scripts`. It connects to an already running OpenCode
2.2.5 service, configures only its fresh fixture, waits for scoped catalogues,
and dispatches native commands through the client. It never manages a service
or reloads unrelated locations. No model or session is started by `--help`.

```sh
npm run test:live:opencode -- --help
npm run test:live:opencode -- --scenario fix-to-clean --provider lmstudio --model recursivesi/flint --variant default --procedure "$PWD/.agents/skills/openspec-verify-change/SKILL.md"
npm run test:live:opencode -- --scenario stop --provider lmstudio --model recursivesi/flint --variant default --procedure "$PWD/.agents/skills/openspec-verify-change/SKILL.md"
```

Choose an available provider/model explicitly; Flint is an example, not a
fallback. The supplied procedure must be installed. Each command prints its
retained evidence summary. Fix-to-clean checks native worker identities/model,
one start and terminal notice, tool-free reporting and independent greeting
behavior. Stop waits for an active worker, dispatches the native stop command,
and checks confirmed inactivity. A completion race is not a stop pass.

The interactive/native-unload and injected-failure recipes below remain separate
manual diagnostics; the two live scenarios do not establish coverage for them.

### bb live commands

Run `npm ci` and `npm run check` first. Install this checkout explicitly and
enable Workflows before running either scenario; the harness verifies the
installation and never changes global plugin configuration:

```sh
bb plugin install "path:$PWD" --yes
bb plugin enable workflows
npm run test:live:bb -- --help
npm run test:live:bb -- --scenario fix-to-clean --provider claude-code --model claude-sonnet-5-5 --reasoning-level medium --permission-mode auto --procedure "$PWD/.agents/skills/openspec-verify-change/SKILL.md"
npm run test:live:bb -- --scenario stop --provider claude-code --model claude-sonnet-5-5 --reasoning-level medium --permission-mode auto --procedure "$PWD/.agents/skills/openspec-verify-change/SKILL.md"
```

Choose an available provider/model explicitly. `auto` or `full` is required;
ACP providers need `full`; see the README's ACP section. The fixture gets a
normal thread in its own bb project. Its
prompt names the installed loop skill, including on ACP where slash text alone
does not select it. The driver queries workflow status/history in that fixture
project, checks one launch/preview, inherited worker settings, fresh sequential
workers and completion without relaunch. The stop scenario sends a normal user
stop request to the starting thread and checks its stop command and cancellation.
Direct workflow/thread stops are labeled emergency cleanup.

The live launch establishes that the starting thread can use the skill. Worker
skill hiding stays covered by `tests/bb-server.test.ts`. The driver does not
record live skill catalogues or use `bb thread commands` as a catalogue: that
command does not list bb plugin skills. The retained project, threads and
fixture can be inspected using the IDs in `result.json`; remove them manually
after reviewing the evidence and confirming cleanup.

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
6. Repeat step 2 from a local Flint thread in `full` mode on the built-in
   `acp-opencode` provider, picking the skill from the `/` menu or naming it in
   the prompt (see the README's ACP section). Confirm that workers
   run on Flint and the run reaches a verdict.
7. Keep worker skill hiding covered by `tests/bb-server.test.ts`: Workflows
   workers get no loop skill from the server entry. The live skill launch
   establishes the starting thread's access. Do not infer plugin skill
   visibility from `bb thread commands` or record live catalogue observations.

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

### bb live harness (2026-11-07)

The bb checks used bb 0.49.0, `claude-code` / `claude-sonnet-5-5`, medium
reasoning and `auto` permission mode, against the working tree based on
`e05d3d5`. The production loop script and plugin bundle were unchanged.

| Scenario | Run | Outcome |
| --- | --- | --- |
| Stop | `wfr_68a16514-a368-4395-b225-d7319e02c0d4` | Passed: one skill launch and matching preview, active verifier cancelled through the starting thread's stop command, no subsequent worker, inherited settings and confirmed cleanup without fallback. The selected temporary procedure copy matched the supplied procedure's content. |
| Fix-to-clean | `wfr_f728fe1a-efde-40e5-a51c-8a1f337a40e6` | Failed scenario despite a clean loop after 2 verifications: the origin's preview omitted a hyphen in the run ID (`wfr_f728fe1a-efde-40e5-a51c8a1f337a40e6`). All independent greeting checks and fixture tests passed, no design was created, workers were fresh/sequential with inherited settings, and cleanup was confirmed without fallback. The mismatched preview was not accepted or retried. |

Earlier repair attempts `wfr_47b245fa-3464-4b37-ac77-6bae4c89b03a` and
`wfr_707071a9-04cf-499f-a1e7-8070fef3a97c` returned `blocked` because a verifier
wrote an extra footer after `VERDICT: CLEAN`. Their fixtures were repaired, but
those attempts remain failed. The harness preserves the loop's actual result;
it does not reinterpret a clean-looking report as a clean terminal result.

Development attempts also exposed asynchronous environment attachment after
thread creation and shell command substitution removing trailing LF bytes from
the script. The driver now retains the origin identity before waiting for its
environment, accepts that documented script transport difference, and captures
the selected procedure's hashes before temporary copies disappear. Initial
attempts remain failed, with separate controller-recovery records confirming
their runs and threads were stopped. These cases and malformed previews are
covered by deterministic fake-CLI tests. No live skill catalogue is recorded.

### Live harness development (2026-11-06)

Native OpenCode checks used the existing 2.2.5 service (PID 84809), local
`lmstudio/recursivesi/flint#default`, and isolated package snapshots of the
working tree based on `e05d3d5`. The production loop and plugin bundle were
unchanged. Each attempt retained its fixture and machine-readable evidence.

| Scenario | Run | Outcome |
| --- | --- | --- |
| Initial fix-to-clean attempt | `run_1a1b21c67c3164b987ae5cb4b2383205db111bf945a` | Failed attempt: interrupted during harness development; cleanup confirmed inactivity, with native fallback for reporting. No repair pass claimed. |
| Initial stop attempt | `run_1a1b21d2cfbe6adb5103cff4c1b8a2d7ba218bb8f94` | The active verifier stopped, but the watcher did not recognize a reporting boundary without an intervening idle record. The driver was interrupted and cleanup confirmed; this attempt remains failed. |
| Stop after watcher correction | `run_1a1b2206d3924b3c01834f84a48b97873f8655c2106` | Passed: active verifier interrupted; one start and one stopped notice; both reporting responses used no tools; no subsequent worker; origin and worker confirmed inactive without native fallback. |
| Fix-to-clean after watcher correction | `run_1a1b2206fce07748e6277c345f3b1c20c116a47ebfb` | Passed: fresh verifier, fixer and fresh verifier on Flint; clean after 2 verifications; external named/empty/missing greeting assertions and fixture tests passed; no design created; reporting used no tools; cleanup confirmed without fallback. |

The observed reporting sequence can be `synthetic`, completed assistant reply,
next `synthetic`, completed assistant reply, `idle`. The deterministic driver
tests now cover that sequence. A queued notice does not require an idle record
between reporting responses.

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
| bb#6871 fix, catalogue (no custom profile) | 2026-11-08 | bb 0.49.0, built-in `acp-opencode`, OpenCode 2.2.5, `customAgents` unset | n/a | `bb provider models acp-opencode --project <id> --selected-model lmstudio/recursivesi/flint --json`, 7 rounds 70 s apart in 4 projects, then once in a fresh worktree | Flint `known`, `[medium, default]` in 29 of 29 reads (0.48.1: `[]` in most); Bonsai `known`, `[]` |
| bb#6792 fix, Workflows (no custom profile) | 2026-11-08 | bb 0.49.0, built-in `acp-opencode`, `lmstudio/recursivesi/flint`, medium, `full`, worktree sub-thread `thr_73ydnfk84p` | n/a | `wfr_d21aacd5-a604-4569-b4f9-d6056571dd5b` (inherited `agent()`), `wfr_e65a65bd-7767-49d9-b4f6-cd427f845bd1` (Flint at `medium`), `wfr_84dca662-cd8f-478e-bd77-6e98092767bc` (Bonsai, empty list, at `medium`) | all three validate; both Flint runs succeed with the exact reply; the Bonsai selection is accepted and its worker dispatched, then LM Studio refuses the prompt as longer than Bonsai's loaded context length |

The Git install in task 4.5 was waived until the branch is pushed; the plugin was
loaded from the checkout path instead.
