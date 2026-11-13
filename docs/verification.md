# Verification

## Automated checks

```sh
npm ci
npm run check
```

Run both with the same npm cache: the same `npm_config_cache`, or both on the
default. The offline snapshot test installs production dependencies from that
cache; an `ENOTCACHED` failure in `tests/live-opencode.test.ts` means the caches
differ.

The suite checks types, builds `dist/index.js`, runs the tests and validates the
package. Tests use fake host and worker adapters; no model request, real Pi or OpenCode
session or bb workflow is started. Local subprocess checks verify Pi ownership
and cancellation; these need permission to inspect process identities with `ps`.

Pi deterministic checks cover invoking settings/auth, explicit role tools,
fresh conversations, atomic prompt admission and lost outcomes, saved-call
replay, read-only reporting that writes nothing, recovery compatibility,
independent owners, process descendants after owner death, stop, shutdown and
cleanup retry. `tests/durable-readonly.test.ts` checks the installed Pi Durable
read-only JSONL open without a model: it changes no file over a torn tail and an
unconfirmed sidecar record, creates no missing directory, and, beside a writer
subprocess, keeps a held handle at its open state while fresh opens see newer
commits. Fake
RPC live-driver cases cover native command dispatch, provenance, independent
fixture checks, stop races, duplicate admissions and bounded failure cleanup.

## Opt-in Pi checks

Requires Node >=22.19, Pi 1.5.2 on PATH, the installed verify procedure,
and an explicitly selected available provider/model. The driver uses isolated
agent state and package resources, so credentials must be available through
the environment or an explicitly supplied provider extension. It installs no
global packages and changes no user package settings.

```sh
npm run test:live:pi -- --scenario fix-to-clean --provider <provider> --model <model> --reasoning-level medium --procedure /absolute/path/to/openspec-verify-change/SKILL.md
npm run test:live:pi -- --scenario stop --provider <provider> --model <model> --reasoning-level medium --procedure /absolute/path/to/openspec-verify-change/SKILL.md
npm run test:live:pi -- --scenario resume --provider <provider> --model <model> --reasoning-level medium --procedure /absolute/path/to/openspec-verify-change/SKILL.md
```

For an installed custom provider, add `--provider-extension /absolute/path/to/provider`.
Run `--help` for output and deadline options. Each invocation makes exactly one
attempt in a fresh greeting fixture. A missed active stop or interruption is
recorded as not exercised, exits nonzero and starts no replacement attempt.

`resume` requires a completed call and a pending call before it kills only its
owned Pi process. The restarted host first reports without continuing, then
receives the explicit native resume command. Evidence compares run, worker and
submission identities and the original call/round budget. Only a clean final
result with independent greeting checks and confirmed cleanup passes.

Each retained attempt contains `evidence/summary.md`, `result.json`, native RPC
records, full worker transcripts/settings, the final diff and cleanup outcome.
`pi-agent/` holds the authoritative Durable store. While the host runs, the
driver observes run records through a read-only open of that store; it inspects
worker transcripts only after the host stops and it obtains exclusive ownership. Credentials are redacted from collected
structured evidence. These commands are outside `npm run check` and are not
shipped as plugin resources.

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
[known upstream issues](known-issues.md) first: some entries change how a
manual run has to be set up.

On OpenCode, a newly loaded location's first catalogue read can be empty. Supply
a local plugin package directory with its manifest, and wait until the location
advertises the plugin and skill before starting a check. A global
`opencode reload` is unnecessary and would affect other loaded locations.
`opencode run "/opsx-verify-loop …"` sends the slash text as a prompt, not as a
command; send native commands headlessly with the client's
`session.command({sessionID, name, text})`.

### OpenCode live commands

Run `npm ci` and `npm run check` first, on Node >=22.19. The driver snapshots the
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

To test a published commit instead, install it with
`bb plugin install "git:github.com/<owner>/openspec-verify-loop@<commit>" --yes`
from a checkout of that commit. The driver then requires every tested plugin
file in bb's cached copy to match the checkout and ignores the `dist/server.js`
bundle bb builds beside them.

Choose an available provider/model explicitly. `auto` or `full` is required;
ACP providers need `full`. The fixture gets a normal thread in its own bb
project. Its prompt names the installed loop skill. The driver queries workflow status/history in that fixture
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
   `acp-opencode` provider. Confirm that workers run on Flint and the run
   reaches a verdict.
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

### bb stable procedure path (2026-11-12)

With the skill taking the procedure path from `bb skill list` (commit
`166d2a0`, installed with `path:`), `fix-to-clean` on `claude-code` /
`claude-sonnet-5-5`, medium reasoning, `auto`, passed: run
`wfr_803935ac-620b-4ede-ae48-c8d3c2c3517c` ended `clean` after 2
verifications, with every harness check passing, including the new
"Supplied procedure outlives the run". The origin passed the fixture's
`.bb/skills/openspec-verify-change/SKILL.md`, not a bridge copy, and both
verifiers read that file. Evidence:
`/Users/dmitry/.bb/thread-storage/thr_6cyyqpmcge/bb-procedure-path-live/loop-live-bb-tWDPh4/evidence/`.

### bb Git install (2026-11-12)

bb 0.49.0 installed the pushed `main` commit `3abb23f` with
`bb plugin install "git:github.com/dimiboi/openspec-verify-loop@3abb23f…"`.
The installed workflow script passed `bb workflows validate`.

`fix-to-clean` on `claude-code` / `claude-sonnet-5-5`, medium reasoning,
`auto`, against that install passed: run
`wfr_2d7dff88-f9bf-400a-8014-92aeefb0b03a` ended `clean` after 2
verifications (workers 21 s, 11 s, 18 s), with every harness check, the
greeting checks and fixture tests passing, `design.md` still absent and
cleanup confirmed without fallback. The final verifier found the supplied
procedure path, a temporary copy under bb's Claude Code provider bridge, no
longer present and loaded the same `openspec-verify-change` skill through
its Skill tool instead. Evidence:
`/Users/dmitry/.bb/thread-storage/thr_7r257yxeg2/bb-git-install-live/loop-live-bb-9ij4Sr/evidence/`.
The `stop` scenario was not rerun: it does not depend on the install source.

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

## Pi Durable implementation checks (2026-11-09)

Pi and Pi Durable 1.5.0, Node 26.13.0, local
`lmstudio/qwen3.8-27b-uncensored-mlx` with effective thinking `off`, or
`lmstudio/recursivesi/flint` with thinking `medium` as indicated below. Each attempt
used an isolated package snapshot, fixture and agent-state directory; the
source checkout and global package setup were not changed. Snapshot identities
and full native/worker records are retained in each evidence directory.

| Scenario | Run / evidence | Outcome |
| --- | --- | --- |
| Setup with requested medium thinking | `/private/tmp/loop-live-pi-aiGrmm/evidence/summary.md` | Refused before launch: Pi advertises this model as non-reasoning and selected off. No worker was started. |
| Active-worker stop | `run_1a1bda49da2812b6df4dc8640efa9e6867eb512b627`; `/private/tmp/loop-live-pi-ybXU9K/evidence/summary.md` | Passed: native start and stop, verifier conversation 9, one input admission, inherited model/off setting, confirmed inactivity and cleanup without fallback. No following worker. |
| Explicit-resume attempt on Qwen | `run_1a1bda7234f83132f6dc02d460b9b1b844e960f9eda`; `/private/tmp/loop-live-pi-CGehfB/evidence/summary.md` | Not exercised: the verifier's second response ended length with zero output tokens. The plugin failed the run without a fixer; cleanup was confirmed. No crash/resume pass is claimed. |
| Fix-to-clean on Qwen | `run_1a1bda191e641137556949942f78440ced225f47f0c`; `/private/tmp/loop-live-pi-w5PU0E/evidence/summary.md` | Failed: reached the fixer after a complete first verification, but the 900-second deadline expired before a fresh final verification. Native cleanup stopped the run and confirmed both workers inactive. No convergence pass claimed. |
| Fix-to-clean on Flint | `run_1a1bdb0080d72f27e17ddab43f5ad2ecfb38f91bafd`; `/private/tmp/loop-live-pi-PnwDDw/evidence/summary.md` | Failed before useful verification: LM Studio returned HTTP 400, refusing to load Flint because it required approximately 38.18 GB more memory under current settings. Worker failure and cleanup were confirmed. No model-server settings were changed. |
| Flint context-switch interruption | `run_1a1bdc74077eb68bf181fdd48839b49c50de4c805bb`; `/private/tmp/loop-live-pi-etUVnd/evidence/summary.md` | Deliberately interrupted during verifier conversation 9 to apply the requested maximum context. Native stop confirmed inactivity and cleanup without fallback. This 65,536-token-context attempt does not establish convergence. |
| Fix-to-clean on maximum-context Flint | `run_1a1bdcb513a5fe474b289d746ff9fd5bd6cfde439af`; `/private/tmp/loop-live-pi-R2A4OO/evidence/summary.md` | Passed at 262,144-token context: verifier 9, fixer 56, fresh verifier 125; one input each, selected model/medium thinking, sequential workers, clean final verification, independent greeting behavior and fixture tests, optional design still absent, no parent model turn. Every worker inactive; cleanup confirmed without fallback. |
| Crash and explicit resume on maximum-context Flint | `run_1a1bde206536f114df452f74bb39f221879097b0ce5`; `/private/tmp/loop-live-pi-43OURQ/evidence/summary.md` | Passed at 262,144-token context: completed verifier 9, hard-killed the owned Pi process with fixer 68 pending, restarted and reported without scheduling work, then explicitly resumed. The original run, arguments, round/call budget, completed reply, conversation IDs and submission IDs survived; no repeated worker or input admission. Fresh verifier 143 returned clean. Independent greeting checks and fixture tests passed, optional design remained absent, selected model/medium thinking was retained, no parent model turn occurred, and every worker was inactive after cleanup without fallback. |

The deterministic checks cover recovery after both verification and fix calls,
reattaching a pending submission, admission failures before/after storage
commit, completion/stop races, provider auth refresh, snapshot loss, competing
processes and supervised descendants after owner death. Live interruption and
convergence outcomes must be read separately from those fake-provider checks.

`npm ci` and `npm run check` passed on Node 26.13.0 with **168 deterministic
tests**, type checking, all generated bundles and package validation. No real
models or Pi/OpenCode agent sessions were called by that suite.

The final deterministic run includes native Pi custom-message error handling
and a delayed-driver completion/stop race. Stop waits for the background
driver before closing storage, so a late driver error cannot create a cleanup
warning after ownership has been released.

Native active stop, convergence and crash/explicit-resume are verified live.
The maximum-context Flint attempts retain the loaded model configuration in
`lmstudio-models.json`, alongside complete native and worker records. Earlier
unsuccessful attempts remain recorded separately.

For these final attempts, the user authorized temporarily unloading Qwen and
loading Flint. Flint ran at its advertised maximum context of 262,144 tokens.
After both successful attempts and confirmed cleanup, Flint was unloaded and
the original `qwen3.8-27b-mlx` instance was restored with context 262,144 and
parallelism 1. The native model API's loaded-instance IDs and configuration
matched the pre-test snapshot. No model-server restart or guardrail change
was needed.

### Monitored Pi/Flint dummy-repository run (2026-11-10)

On `41e2920`, `lmstudio/recursivesi/flint` (context 262,144, parallelism 1,
thinking `medium`) ran `run_1a1c2ab12a08247eed95c434d208dd2456680ef4da0` to
`clean` after 2 verifications in 22 min 34 s, with every harness check
passing. The [monitored-run notes](pi-flint-live-2026-11-10.md) record the
follow-ups: no progress in the native report during a 605-second response,
tool-call markup leaked into the fixer's reply, very long medium-thinking
responses, and the deterministic suite's dependence on the default npm cache.

### Monitored Pi/GLM dummy-repository run (2026-11-10)

On `784b45a`, `openrouter/z-ai/glm-5.3-flash` (thinking `high`; the model
offers no `medium`) ran `run_1a1c2d28e423e5b185b256146f38af5d5d04db8eb55` to
`clean` after 2 verifications in about 2 minutes, with every harness check
passing. The [monitored-run notes](pi-glm-live-2026-11-10.md) record the
follow-ups: the driver cannot use credentials stored by Pi's own login, and a
thinking-level refusal does not list the levels the model supports.

### Pi report activity on Flint (2026-11-10)

On `47232fc` with the uncommitted `address-flint-run-followups` changes, the
recorded Flint fix-to-clean command (same LM Studio provider extension, context
262,144, parallelism 1, thinking `medium`) ran
`run_1a1c2e9897e1e46481f2979472b891083418cb32a5c` to `clean` after 2
verifications in about 28 min 42 s, with every harness check passing (verifier
9, fixer 124, fresh verifier 193). Evidence:
`$BB_THREAD_STORAGE/flint-pi-activity/` of thread `thr_duh9zvzxq8`, with
`pi-reports.jsonl` (1,720 snapshot polls) in `loop-live-pi-0DyPnI/evidence/`
and LM Studio per-response stats in `lmstudio-stream.jsonl`.

**Activity advanced.** The first verifier waited 989 s over 20 LM Studio
responses. Its final response ran 295 s (9,177 tokens); during it the
snapshot's `activity.at` moved every 30.0–30.1 s, and its last value was 6 s
before LM Studio finished the response. The only gap above 40 s (76 s) matches
a 64 s stretch with no LM Studio response between two shorter ones. The
snapshot revision stayed 4 for the whole verifier, so activity committed no run
records. Each later worker started a new activity time, and the final snapshot
had no `activity`.

### Pi read-only report on Flint (2026-11-10)

On `4f9292c` with the uncommitted `read-pi-store-read-only` changes (Pi, Pi
Durable and Chord 1.5.1; committed during the run as `7a442ea` and `1f29dad`,
and the run's plugin snapshot `dist/pi.js` and `package.json` match them byte
for byte), the recorded Flint fix-to-clean command (same LM Studio provider
extension, context 262,144, parallelism 1, thinking `medium`) ran
`run_1a1c43c0dec6e3d81e3578446ea8b67cbd21960e049` to `clean` after 2
verifications and 1 fix in about 26 min 1 s, with every harness check and
cleanup step passing (verifier 9, fixer 62, fresh verifier 157). Evidence:
`$BB_THREAD_STORAGE/flint-pi-readonly/` of thread `thr_iv34xsxftj`, with
`pi-reports.jsonl` (1,538 read-only polls) in `loop-live-pi-q9JGEg/evidence/`,
LM Studio per-response stats in `lmstudio-stream.jsonl`, and 0.5 s samples of
every `store/` file's size and mtime in `store-samples.jsonl`.

**Activity follows the stream.** The first verifier waited 592 s over 8 LM
Studio responses. Its final response ran 449.5 s (18,564 tokens); during it
`committed` took 422 distinct values, one per poll, 1.01–1.13 s apart (median
1.06 s, the poll interval). The first value came 0.9 s after the response began
and the last was 0.57 s before it finished, against 30.0–30.1 s steps ending 6 s
early on 1.5.0. The verifier's largest gap (9.0 s) matches the 8.8 s of prompt
processing before the second response's first token; the next (4.7 s) matches
the first response's 3.6 s. The revision stayed 4 for the whole verifier.

**Polls only read.** No poll failed. The `not_found` retry is not logged, so a
retried listing race would not show in the evidence. During the fresh
verifier's last 50 s prompt processing, with no LM Studio output, 49 polls left
all 24 `store/` files (665,016 bytes) unchanged in size and nanosecond mtime;
the first change came with the first output token. Fixer stretches of 11 s and
9 s, with 11 and 9 polls, were also unchanged.

### Pi resume and rendered report on GLM (2026-11-10)

On `e384d16`, the driver now sends `/opsx-verify-loop-report` once while a
worker call is pending and checks the rendered activity line against the
`committed` time of a read-only `readRecords()` taken before and after it.
`openrouter/z-ai/glm-5.3-flash` (thinking `high`) ran the `resume` scenario as
`run_1a1c4607d09f840b83596e742ce8a4ad2ee931d7bc4`: verifier 9, then the
owned Pi process was hard-killed with fixer 46 pending, restarted, reported,
and explicitly resumed; fresh verifier 81 returned `clean` after 2
verifications in about 76 s of worker time. Every harness check and cleanup
step passed: the run, round budget, completed reply and conversation and
submission IDs survived the restart with no repeated worker or input
admission, independent greeting checks and fixture tests passed, the optional
design stayed absent, and no parent model turn occurred. Evidence:
`$BB_THREAD_STORAGE/glm-pi-resume/loop-live-pi-cYHffA/evidence/` of thread
`thr_j7erdkb3qz`.

**Rendered report matches the store.** During verifier 9 the report showed
`Last worker activity: 2026-11-10T07:33:40.328Z (1 s before this report)`;
the store's `committed` time before and after the report was
1794296020328.286 ms, the same instant. After the restart, the report showed
the run as `interrupted` with no activity line, and the store revision did not
change while the restarted process idled.

**The `not_found` retry stays unlogged.** `tests/durable-readonly.test.ts`
covers the retry against Durable 1.5.1, an exhausted retry fails the report
visibly, and the retry goes away once earendil-works/pi#11994 is fixed, so no
logging is added before a retry is observed to matter.
