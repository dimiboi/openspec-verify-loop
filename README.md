# OpenSpec verification loop for OpenCode

An installable skill and `/verify-loop` command that runs a fresh verifier, sends
the complete report to a fresh fixer, and repeats full verification until every
critical issue, warning, suggestion, and applicable unverified check is resolved.

The TypeScript controller owns the loop. Reports, worker identities, independent
check evidence, and recovery state are saved outside the consuming checkout.

## Requirements

- OpenCode **2.2.5**, configured with an available model.
- OpenSpec **1.16.0**, with `openspec-verify-change` installed in the consuming project.
- Node.js **22.18 or later** and Git.
- A repo-local active OpenSpec change. Stores and multi-repository changes are
  detected and unsupported in this release.

These versions are deliberately pinned while the OpenCode API evolves. Model
selection is configurable and defaults to the consuming project's OpenCode
configuration. No provider or model is hardcoded by the skill.

## Install into a project

From the consuming project, install from a local copy of this repository:

```sh
npx skills add /absolute/path/to/openspec-verify-loop --skill openspec-verify-loop -a opencode
```

The repository includes the generated runtime bundle, so the consumer does not
need TypeScript, Bun, a build step, or npm dependencies. Both copied installations
and skill-installer symlinks are supported. The source repository is not yet
published; after publication the local source argument can be replaced with its
Git URL.

Then install the command and worker profiles:

```sh
node .agents/skills/openspec-verify-loop/scripts/controller.mjs setup --project .
opencode reload
```

The current Skills CLI uses `.agents/skills`, which OpenCode discovers. If your
installer uses a different path, run `scripts/controller.mjs` from the
actual installed skill directory. Setup creates these project files:

```text
.opencode/commands/verify-loop.md
.opencode/agents/openspec-loop-verifier.md
.opencode/agents/openspec-loop-fixer.md
```

Setup is repeatable. It updates untouched generated files and refuses to
overwrite customized files, returning the existing and proposed contents for
review. `setup --replace` explicitly replaces those reviewed files. It leaves
your OpenCode model/provider configuration alone. Removing the skill with a
skill installer does not remove these three generated project files; remove
them separately if you no longer want the command/profiles.

If the project lacks the verification skill, enable OpenSpec's expanded verify
workflow using `openspec config profile`, then refresh that project's tool files
with `openspec update`. The loop reports a missing prerequisite rather than
changing your OpenSpec configuration automatically.

## Use

Inside OpenCode:

```text
/verify-loop
/verify-loop add-export
```

An explicit name wins. Otherwise the launcher validates a change identified in
the conversation, or the controller selects the only active change. Multiple
active changes require a choice; no active changes start no worker.

The launcher runs the controller in the background and reports its run ID and
state directory. Workers run sequentially in the same checkout. A dirty tree is
allowed; unrelated tracked and untracked work must be preserved.

Clean requires a **fresh full verification**, zero findings at every severity,
evidence for all prior resolutions, no applicable incomplete/failed checks, and
passing independently executed required checks. An agent exit code or a fixer's
claim of completion is insufficient. Justified not-applicable checks are allowed.

There is no default round cap. Two consecutive fix cycles without demonstrable
progress stop the run. Optional explicit time/round limits also stop
unsuccessfully. The workflow does not commit, archive, push, merge, or deploy.

## Configure models and checks

Create `.opencode/openspec-verify-loop.json` in the consuming project:

```json
{
  "verifierModel": "provider/model",
  "fixerModel": "provider/model",
  "checks": [
    { "id": "tests", "command": ["npm", "test"], "timeoutMs": 300000 },
    { "id": "types", "command": ["npm", "run", "typecheck"] }
  ]
}
```

Omit model fields to use the worker profiles' configured models or the OpenCode
default. `provider/model#variant` selects a variant. Missing or disabled models
are prerequisite failures; there is no silent substitution.

Check commands are argument arrays, executed directly without a shell by the
controller before each verifier. Check `cwd` defaults to the project root and
must remain inside it. Outputs and exit codes are saved as evidence. Generated
check outputs should be Git-ignored: a check that modifies source/unignored files
stops verification. OpenSpec strict validation and apply/task evidence are always
collected independently.

Optional settings: `skill` (explicit advertised verification `SKILL.md`), `server`
(explicit OpenCode endpoint), `stateDir`, `maxRounds`, and `maxMinutes`.
Configuration precedence is CLI options, project configuration, then defaults.
The controller uses an existing compatible local service or starts one through
the OpenCode client; it never stops the shared service at exit. For an explicit
authenticated endpoint, use `OPENCODE_TOKEN`, not credentials in the URL.

The project `.opencode/skills/openspec-verify-change/SKILL.md` takes precedence;
otherwise the controller resolves the advertised verification skill. The
procedure and its resource directory are pinned for the run.

## Status, permission requests, resume, and stop

The controller emits JSON lines. The first `started` event includes `runId` and
`runDir`; worker events include OpenCode session IDs. Saved artifacts include:

```text
state.json
events.jsonl
rounds/001/verifier.raw.json
rounds/001/checks.json
rounds/001/verifier.json
rounds/001/verifier.md
rounds/001/fixer.json
rounds/001/fixer.md
final.json
final.md
```

By default, state uses the platform user state directory under
`openspec-verify-loop`, keyed by canonical checkout path. `XDG_STATE_HOME` is
respected. `--state-dir` selects another location outside the checkout and skill.
Checkout reservations use the common user state directory even when report
storage is overridden, preventing two loops from editing the same checkout.

```sh
node <skill>/scripts/controller.mjs status --project . --run <run-id>
node <skill>/scripts/controller.mjs resume --project . --run <run-id>
node <skill>/scripts/controller.mjs stop --project . --run <run-id>
```

Use the original options when resuming, including any CLI model/limit/storage
overrides. Changes to requirements, the procedure/resources, profiles, target,
or effective configuration invalidate the pinned run. Review those changes and
start a new run. A completed clean run cannot be resumed; start another to
verify again. An exhausted limit remains exhausted on resume.

A permission request or question saves `awaiting_input` with its exact worker
session/request and retains the checkout reservation. Answer in that OpenCode
worker session, then explicitly resume. No permissions are auto-approved.
Verifier edit tools are denied; shell inspection commands have narrow rules,
and other commands may require approval. These permissions are not a filesystem
sandbox. Unexpected source changes during verification invalidate the result.

OpenCode 2.2.5 can restart execution when re-prompted with an already delivered
input ID. Recovery therefore reads the existing inbox/messages and **never
re-prompts a delivered input**. If a crash/lost response makes admission uncertain
and no input is visible, the run stops with its reservation intact rather than
guessing. Inspect the worker, use `stop` to reconcile cancellation, and start a
new run once termination is confirmed. If confirmation fails, retain the lock
and diagnose the worker; do not delete the lock to bypass an active worker.

Closing the launching chat does not erase saved reports. Automatic chat recovery
after reopening is not guaranteed. Use `status` to inspect and explicit `resume`
to continue. A stop request during a running check may wait until that check's
configured timeout before worker reconciliation completes.

| Exit | Meaning |
| --- | --- |
| 0 | Clean, setup complete, or successful status inspection |
| 2 | Change selection required or no active change |
| 3 | Blocked, awaiting user input, or stop still being reconciled |
| 4 | Execution or report-contract failure |
| 5 | Explicit round/time limit |
| 130 | Interrupted |

For outcome decisions, read `final.json` as well as the exit code. `status`
returns exit 0 when inspection succeeds, regardless of the saved run's outcome.

## Development and verification

```sh
npm ci
npm run check
```

`check` type-checks, rebuilds the self-contained ESM bundle, runs deterministic
tests against isolated OpenSpec projects and fake worker outcomes, and validates
the skill resources. The development dependencies include OpenSpec 1.16.0.
The generated bundle is included for Git skill installation; CI rejects drift.

Optional integration exercises require a configured OpenCode service/model:

```sh
node scripts/probe.mjs
node_modules/.bin/tsx tests/api-spike.ts
VERIFY_LOOP_LIVE_MODEL=provider/model npm run test:live
```

The live exercise copies the installed skill into a separate Git project with a
deliberate greeting bug and a failing test. It requires a verifier/fixer/verifier
cycle, fresh session IDs, and a final passing test. Reports and fixture files are
retained in an isolated temporary directory, with its location recorded in
`.live/latest-live.json`. The test harness simulates a user allowing only a
predeclared set of fixture inspection/check commands, exercising explicit resume;
unknown permissions/questions fail the exercise. The API spike uses local Flint; edit its
model setting for a different local setup. Live tests are opt-in and do not run
in ordinary CI.

See [PLAN.md](PLAN.md) for the original implementation plan and
[verification.md](docs/verification.md) for observed validation and limitations.
