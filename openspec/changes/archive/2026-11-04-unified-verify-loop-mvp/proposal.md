# Proposal

## Why

Running `openspec-verify-change`, pasting its report into a fixer session, and
verifying again until clean is a manual loop the user repeats by hand. Two
existing plugins automate it, one for bb (`bb-openspec`) and one for OpenCode
(this repository). Each grew large from defensive machinery that guards against
failures nobody has observed, and they share no code.

This change replaces both with one minimal loop that installs natively on either
host and uses the starting session's model. It implements the MVP cut of
the capability roadmap. Further capabilities are added only when real runs show
the need; they are listed with their triggers in `docs/future-improvements.md`.

## What Changes

- **One shared loop script**, `skills/openspec-verify-loop/verify-loop.js`, in bb
  workflow format. Each round runs a fresh verifier on the installed
  `openspec-verify-change` procedure; when that finds issues, a fresh fixer
  receives the full report and fixes everything. The loop ends on
  `VERDICT: CLEAN`, on `VERDICT: UNVERIFIED` (no issues, but checks left Not
  verified), on `VERDICT: BLOCKED`, or at the round limit (default 5).
  The last round is always a verification. A change name or `--store` that the
  user gives passes through unchanged. Later rounds keep the change named in
  round 1's report. One block of prompt rules applies to every worker:
  - the verifier does not edit files;
  - workers report real exit codes;
  - workers do not commit, push, merge, deploy, sync specs or archive.
- **bb front.**
  - The repository becomes a bb plugin with an empty server entry; bb requires
    one in every manifest.
  - Its `openspec-verify-loop` skill submits the shared script with
    `bb workflows run --script` and posts the workflow preview.
  - The workflow's done notice reports the result. `bb workflows stop` stops the
    run.
  - Workers inherit the starting thread's provider, model, reasoning and
    permission mode through Workflows.
- **OpenCode front.** The plugin runs the same script file and implements
  `agent()` with its existing session code:
  - workers use the invoking session's model and variant;
  - a prompt is never resubmitted;
  - the OpenCode version and hosting-server checks are kept;
  - stopping, and unloading the plugin, interrupt the active worker;
  - the result comes back as the existing tool-less notice.
- **BREAKING:** the OpenCode controller is removed, along with everything it
  carried:
  - pinning of the target, procedure and configuration;
  - plugin-run checks;
  - the JSON report contract;
  - persisted run state, checkout reservations and resume;
  - stall detection;
  - role model options.
- **BREAKING:** the `/verify-loop-status` and `/verify-loop-resume` commands, and
  the tool's `status` and `resume` actions, are removed.
- **BREAKING:** the remaining OpenCode commands are renamed `/opsx-verify-loop`
  and `/opsx-verify-loop-stop`, matching OpenSpec's own `/opsx-*` commands in
  OpenCode.
- **BREAKING:** these plugin options are removed: `verifierModel`, `fixerModel`,
  `skill`, `stateDir`, `maxMinutes` and `checks`. `server` and `maxRounds`
  remain.
- **BREAKING:** on bb this plugin replaces `bb-openspec`, which uses the same
  skill name. Uninstall `bb-openspec` first.
- The OpenCode skill text moves out of `skills/` to `opencode/SKILL.md`, so that bb
  does not load it, and is rewritten for the reduced tool.
- `AGENTS.md`, `README.md`, `docs/verification.md` and the roadmap (now
  `docs/future-improvements.md`) are updated to match.

## Capabilities

### New Capabilities

- `verification-loop`: the shared loop's behaviour on both hosts. Covers
  verifier and fixer rounds, stop conditions, the clean rule, change and store
  pass-through, worker prompt rules, and the result it returns.
- `bb-integration`: installing and running the loop as a bb plugin. Covers the
  manifest, launch through Workflows, inherited settings and permission modes,
  reporting and stopping.
- `opencode-integration`: installing and running the loop as an OpenCode plugin.
  Covers the command and tool, the script runner, model inheritance, worker
  permissions, no-resubmission, stop and unload, host checks, and the result
  notice.

### Modified Capabilities

None. The project has no existing specs.

## Impact

- **Code:**
  - `src/` shrinks to the plugin entry, tool and commands, the OpenCode session
    adapter, worker permissions, and a new script runner.
  - `controller.ts`, `manager.ts`, `state.ts`, `reports.ts`, `prompts.ts`,
    `summary.ts` and `openspec.ts`, and their tests, are deleted.
- **Packaging:** `package.json` gains a `bb` manifest and keeps the OpenCode
  `exports` entry and the prebuilt `dist/index.js`. `scripts/validate-plugin.mjs`
  and the Git-packaging test are updated for the new layout.
- **Dependencies:** `@fission-ai/openspec` is removed if no remaining test uses
  it. No new dependencies.
- **Users:** existing OpenCode runs, state directories and options stop working.
  bb users switch from `bb-openspec`.
- **Requirements:**
  - bb runs need the Workflows plugin enabled and a starting thread in `auto` or
    `full` mode; ACP providers such as local Flint need `full`.
  - OpenCode runs still require OpenCode 2.2.5.
