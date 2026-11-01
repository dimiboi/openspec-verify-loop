# OpenSpec verification loop for OpenCode

A native OpenCode plugin that verifies an OpenSpec change, sends every finding to
an independent fixer, and repeats full verification until the change is clean.
Every verification and fix uses a fresh session, sequentially in the same checkout.

## Install

Install globally from GitHub:

```sh
opencode plugin add github:dimiboi/openspec-verify-loop
```

Or add the plugin to a project's `opencode.jsonc`:

```jsonc
{
  "plugins": ["github:dimiboi/openspec-verify-loop"]
}
```

Use a release tag or complete commit hash to pin a revision. OpenCode installs and
loads the package and registers its commands, tool, and bundled skill. Consumers
need no setup command, generated agent files, or manual build.

Requirements: **OpenCode 2.2.5**, **OpenSpec 1.16.0**, Git, an available OpenCode
model, and the project's actual `openspec-verify-change` skill. Enable OpenSpec's
verify workflow with `openspec config profile` and refresh project tool files with
`openspec update` if that skill is missing. The plugin reports missing prerequisites
without modifying OpenSpec or model configuration.

Changes must belong to an OpenSpec root at the Git checkout root. Stores, nested
subproject roots, and multi-repository changes are unsupported.

## Use

```text
/verify-loop
/verify-loop add-export
/verify-loop-status
/verify-loop-status <run-id>
/verify-loop-resume <run-id>
/verify-loop-stop <run-id>
```

Start without a name when exactly one change is active. With several changes,
choose one of the returned names. No active change starts no workers. Status
without a run ID lists this checkout's runs.

You can also invoke the bundled `openspec-verify-loop` skill in conversation. It
uses the `openspec_verify_loop` tool with `run`, `status`, `resume`, or `stop` and
optional `change`/`runId` arguments. Commands and the tool use the same controller.

Start and resume return a durable run ID and report location while the OpenCode
server owns the ongoing work. Native command results and final outcomes are
reported through session notices. Reporting turns have their tools removed and
only summarize the saved result. Ordinary user turns keep their tools. Closing a
client does not cancel server-owned work. Plugin unload/reload interrupts owned
work; explicitly resume after reload if needed.

A dirty tree is allowed. Workers preserve unrelated work. The plugin does not
commit, archive, sync specs, push, merge, or deploy.

## Completion and permissions

Clean requires a fresh complete verifier with zero critical findings, warnings,
suggestions, or applicable unverified checks. Every prior finding needs an
explicit resolution with evidence. Independent OpenSpec validation and configured
checks must pass against the reviewed workspace. A fixer's completion claim cannot
make the run clean. Justified not-applicable checks are allowed.

The built-in `build` agent runs both roles with per-session policies. Verifiers
cannot use edit tools; shell commands require approval except for narrow inspection
rules. Shell permissions are not a filesystem sandbox. Unexpected source changes
during verification or a worker commit invalidate the result. Fixers retain the
project's editing/shell rules. Both roles are prevented from delegating or invoking
the loop management interface.

A worker permission request or question saves `awaiting_input` and retains the
checkout reservation. Open its reported worker session, answer the request, then
run `/verify-loop-resume <run-id>`. The plugin never approves requests for you.
A stop can return `stopping` while reconciliation finishes; inspect status before
starting another run.

No default round limit applies. Explicit time/round limits, blockers, failed
execution, malformed reports, and two consecutive fixes without workspace progress
stop unsuccessfully. Time limits include downtime.

## Configure

Set options in the native plugin entry:

```jsonc
{
  "plugins": [
    {
      "package": "github:dimiboi/openspec-verify-loop",
      "options": {
        "verifierModel": "provider/model",
        "fixerModel": "provider/model#variant",
        "checks": [
          { "id": "tests", "command": ["npm", "test"], "timeoutMs": 300000 },
          { "id": "types", "command": ["npm", "run", "typecheck"] }
        ]
      }
    }
  ]
}
```

All options are optional. Model precedence is role option, initiating session's
selected model, the build profile's model, then the project's OpenCode default.
Selections and variants are pinned for the run; changing the chat's selected
model does not change existing workers. Unavailable models fail without substitution.

Check commands are argument arrays executed without a shell before each verifier.
`cwd` defaults to the consuming checkout and must remain inside it; `timeoutMs`
defaults to 120000. Exit codes and output are saved. Ignore generated outputs:
checks that modify source or unignored files stop verification. Strict OpenSpec
validation and task/apply evidence are collected independently on every round.

Additional options:

| Option | Meaning |
| --- | --- |
| `skill` | Path to an advertised verification `SKILL.md` when discovery is ambiguous |
| `stateDir` | Report/state directory outside the checkout and installed plugin |
| `maxRounds` | Positive verification-round limit |
| `maxMinutes` | Positive wall-time limit, including downtime |
| `server` | Hosting OpenCode HTTP endpoint for a non-registered service |

Relative paths resolve against the invoking session's Git checkout. The plugin
normally discovers the existing local OpenCode service. It verifies that the
recovery endpoint belongs to the hosting process and has the same initiating
session; it never starts, replaces, or stops an OpenCode service. For an explicit
authenticated endpoint, provide `OPENCODE_TOKEN` in the server environment;
credentials, query strings, and fragments are rejected in endpoint URLs.

## Reports and recovery

State uses the platform user state directory under `openspec-verify-loop`, honoring
`XDG_STATE_HOME` or the `stateDir` option. Files are keyed by canonical checkout
and run ID under `runs/<checkout-key>/<run-id>/`:

```text
state.json
events.jsonl
rounds/001/checks.json
rounds/001/verifier.raw.json
rounds/001/verifier.json
rounds/001/verifier.md
rounds/001/fixer.raw.json
rounds/001/fixer.json
rounds/001/fixer.md
final.json
final.md
```

A shared checkout reservation prevents overlapping loops even when report locations
differ. Resume reconciles saved worker/input identities rather than replaying
possibly delivered prompts. OpenCode 2.2.5 can restart execution for a duplicate
input ID, so uncertain admission with no visible saved input stays blocked and
reserved. Unconfirmed worker termination also retains the reservation. Do not
delete a reservation to bypass a potentially active worker.

Changes to the target, requirements, verification procedure/resources, worker
policy, or plugin configuration invalidate a run. Restore its original configuration
to resume, or stop it and start a new run after reviewing changes. A clean run
cannot be resumed; start another verification. Loading the plugin never automatically
adopts or resumes saved work. Reports remain outside the package after removal.

## Development

Use Node.js **>=22.18**:

```sh
npm ci
npm run check
```

`check` type-checks, builds the ESM plugin, runs deterministic tests with fake host
registries/workers and isolated local OpenSpec fixtures, and validates the exported
package and skill resources. It makes no model calls and starts no OpenCode session.
`dist/index.js` is committed so Git installations require no build hook. Runtime
dependencies are external imports installed by OpenCode's package manager.
The development bundler is named `bundle`: npm treats a `build` script as a Git
preparation trigger even when the generated output is already committed.

For development, point a consuming project's plugin entry at this repository's
absolute directory, then rebuild with `npm run bundle`. See
[verification and manual testing](docs/verification.md) for the checks you can run
in OpenCode. Real-host and model testing are separate from the automated suite.
