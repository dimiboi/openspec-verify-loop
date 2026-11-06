# OpenSpec verification loop

Verifies an OpenSpec change, sends the full report to a fresh fixer, and repeats
the verification until it is clean. It installs as a plugin on bb or OpenCode.
Both hosts run the same loop script,
[`skills/openspec-verify-loop/verify-loop.js`](skills/openspec-verify-loop/verify-loop.js).

Each round:

1. A fresh verifier runs the project's `openspec-verify-change` procedure and
   ends its report with `VERDICT: CLEAN`, `VERDICT: UNVERIFIED`,
   `VERDICT: ISSUES` or `VERDICT: BLOCKED <reason>`.
2. If the report has issues and rounds remain, a fresh fixer receives the full
   report and fixes every issue.

The loop ends `clean`, `unverified`, `blocked`, or `limit` after the round limit
(default 5). The last round is always a verification. Clean needs
`VERDICT: CLEAN` and a report with no nonzero count of critical issues, warnings
or suggestions and no `Not verified` check. When the report has a Final
Assessment section, the verify skill's own summary, the loop reads only that
section, so a report that quotes such marks while describing tests or specs
can still be clean. Unverified needs
`VERDICT: UNVERIFIED` and a report with no such count but at least one
`Not verified` check, for example tests that could not run because the
project's dependencies are not installed. The loop then stops without a fixer,
and you decide whether to archive. A change without `design.md` is not
unverified: the design is optional, so verifiers mark Design Adherence
Not applicable, and the change can end `clean`. Fixers are told not to create
optional artifacts to satisfy a check.
A verifier reply whose last line is not one of the four verdicts, such as an
empty or truncated reply, ends the run `blocked` without a fixer.
Workers use the starting session's model, run one at a
time in the same checkout, and are told not to ask questions, not to commit,
push, merge, deploy, sync specs or archive, and not to start loops or workflows or
delegate to other agents. Verifiers are told not to edit,
create or delete files in the checkout; temporary files outside it, such as
command output under `/tmp`, are allowed.

The result is `{status, change, rounds, reason, report}`, where `report` is the
last worker's reply. A dirty tree is allowed; workers preserve unrelated work.

Every host needs the project's `openspec-verify-change` skill. If it is missing,
enable OpenSpec's verify workflow with `openspec config profile` and refresh the
project's tool files with `openspec update`.

## bb

### Install

1. Install this repository:

   ```sh
   bb plugin install git:https://github.com/dimiboi/openspec-verify-loop.git
   ```

2. Enable the Workflows plugin: `bb plugin enable workflows`.

### Use

Start from a thread in `auto` or `full` mode. Workers are hidden threads that
inherit the thread's permission mode, so a mode that asks before shell commands,
such as `accept-edits`, stalls them on the first approval. ACP providers such as
local Flint offer only `accept-edits` and `full`, so they need `full`. The
plugin does not check the mode.

```text
/openspec-verify-loop [change] [--store <id>] [--max-rounds <n>]
```

The skill starts one workflow and posts its preview. Workers inherit the
thread's provider, model, reasoning level and permission mode. Workers do not
see the skill, so they cannot start a loop through it. Without a change,
the first verifier selects the only active change; with several active changes
the run ends `blocked` and lists them. When the run ends, the thread reports the
result from the workflow's completion notice and starts no new run. To stop a
run, ask the thread to stop it; it runs `bb workflows stop <runId>`. The
Workflows preview and history keep every round's report.

### ACP providers and local Flint

On ACP providers such as OpenCode, typing `/openspec-verify-loop` as plain text
does not start the skill: OpenCode does not know bb's plugin skills, so the
agent only sees the text. Pick the skill from bb's `/` menu, or name it in the
prompt, for example "Use the openspec-verify-loop skill on change add-export".

The built-in `acp-opencode` provider can record local Flint with no reasoning
levels, and Workflows then refuses to start its workers. bb's model discovery
stores another model's reasoning options under Flint when OpenCode answers a
model switch late (anomalyco/opencode#60316, get-bb/bb#6871), and Workflows
rejects models with an empty list (get-bb/bb#6792). Both are fixed upstream but
not in a release yet (bb 0.48.1). Until one ships, start Flint loops from a
custom ACP profile whose `nativeReasoning` setting fills in `medium`:

```sh
bb plugin config provider-acp set customAgents '[{"id":"opencode-default-compat","displayName":"OpenCode (default compatibility)","command":"opencode","args":["acp"],"dialect":"opencode","supportsManualCompaction":true,"providerUsage":true,"nativeSkillRoots":{"user":[".claude/skills",".agents/skills"],"project":[".opencode/skills",".claude/skills",".agents/skills"]},"nativeReasoning":{"configId":"effort","supportedLevels":["medium"],"defaultLevel":"medium","levelValues":{"medium":"default"}}}]'
```

This replaces any existing `customAgents` value, so merge entries you already
have. The profile appears as provider `acp-opencode-default-compat`; start a
Flint thread on it in `full` mode, at medium reasoning. Custom profiles cannot
fork threads. See [known upstream issues](docs/known-issues.md) for the details.

## OpenCode

### Install

Requires **OpenCode 2.2.5**; the plugin refuses to load on any other version.
Install globally from GitHub:

```sh
opencode plugin add github:dimiboi/openspec-verify-loop
```

Or add it to a project's `opencode.jsonc`:

```jsonc
{
  "plugins": ["github:dimiboi/openspec-verify-loop"]
}
```

Use a release tag or a full commit hash to pin a revision. The package ships a
prebuilt `dist/index.js`, so installation runs no build.

### Use

```text
/opsx-verify-loop [change]
/opsx-verify-loop-stop
/opsx-verify-loop-report
```

The bundled `openspec-verify-loop` skill calls the `openspec_verify_loop` tool
with action `run` (optional `change`, `store` and `maxRounds`), `stop`, or `report`.

`run` returns `started` with the run ID and worker model at once, and the loop
continues in the background. One run per checkout is allowed. Workers use the
model and variant of the turn that started the loop: the tool call's turn, or
the session's current selection for a command. If that model cannot be
identified or is unavailable, the run does not start; no other model is
substituted. The project must advertise exactly one `openspec-verify-change`
skill.

Workers and project skill/model discovery use the invoking session's directory,
so a nested project such as `packages/app` keeps its own OpenSpec root. Sessions
in sibling directories or symlink aliases still share one reservation for the
canonical Git checkout across loaded plugin instances; a stop from any of them
cleans the original worker. Each instance unloads only the runs it owns.

Each worker is a new session in that project directory on the plugin's own OpenCode
server. Verifiers cannot use the edit tool; no worker can use subagents or the
loop tool. Shell commands follow the project's permissions. A worker prompt is
submitted at most once: an uncertain submission is reconciled by its input ID,
and the run fails if the prompt is not found. If a worker waits for a permission
or a question, the run ends `blocked`, names the worker session and interrupts
it when interruption can be confirmed.

When the run ends, the starting session receives one notice with the result or
failure; the turn that reports it has no tools. `/opsx-verify-loop-stop` interrupts
the active worker and ends the run as `stopped`. Unloading the plugin interrupts
the active worker too. A run does not survive an OpenCode restart; start it
again.

If result delivery fails, the plugin logs the error and run ID and retains the
undelivered result separately from checkout reservations. Use
`/opsx-verify-loop-report` or `{"action":"report"}` to retrieve all pending
results for this checkout and retry their notices to the original sessions.
The reply includes each result and whether delivery succeeded. A loaded plugin
instance can recover another instance's pending results after it unloads.
These results are held in memory and do not survive a server restart or a full
plugin module reload. Successfully delivered results leave the pending list.

If cleanup cannot confirm that a worker stopped, the result is `failed` and
names that worker. The checkout stays reserved, so another loop cannot start
while it might still be editing. Run `/opsx-verify-loop-stop` again (or call
the tool with `{"action":"stop"}`) to retry cleanup. There are no automatic
cleanup retries, and a cleanup retry never resubmits the worker prompt. A
successful retry releases the checkout and replies to the stopping session;
it does not replace the failed run's final notice.

The plugin rejects unload if it cannot confirm interruption. OpenCode 2.2.5
can still remove the plugin and its stop command after that rejection. If this
happens, use OpenCode's native session controls to interrupt the named worker
and confirm it is inactive before starting another loop. See
[the recorded host limitation](docs/known-issues.md#plugin-unload-discards-controls-after-cleanup-rejects).

### Configure

```jsonc
{
  "plugins": [
    {
      "package": "github:dimiboi/openspec-verify-loop",
      "options": {"maxRounds": 8}
    }
  ]
}
```

| Option | Meaning |
| --- | --- |
| `maxRounds` | Default verification round limit (5 if unset) |
| `server` | HTTP endpoint of the hosting OpenCode server, if it is not registered for discovery |

The plugin finds its hosting server, confirms it is the same process and
session, and never starts, replaces or stops an OpenCode service. For an
authenticated endpoint, set `OPENCODE_TOKEN` in the server environment.

## Development

Use Node.js **>=22.18**:

```sh
npm ci
npm run check
```

`check` type-checks, builds `dist/index.js`, runs the deterministic tests and
validates the package. The tests use fake hosts and workers; they call no model
and start no OpenCode session. `dist/index.js` is committed so Git installs need
no build. The bundler script is named `bundle` because npm treats a `build`
script as a Git preparation trigger.

See [verification and manual testing](docs/verification.md) for the manual
checks on each host.
[Known upstream issues](docs/known-issues.md) lists the bb, OpenCode and OpenSpec
bugs that shape the plugin, where each is tracked, and its workaround.
