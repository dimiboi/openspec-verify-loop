# Design

## Context

See `proposal.md` for the motivation, and the three spec deltas for the required
behaviour. The design rests on facts already established in the capability
roadmap (since replaced by `docs/future-improvements.md`), from the bb probe
runs and from the review-loop run:

- A bb workflow script runs sandboxed. It has no shell, filesystem, network,
  clock or random numbers; `bb workflows validate` rejects `Date`,
  `Math.random`, `process` and `require`. Workers spawned by `agent()` keep
  their normal tools.
- `agent()` with no model selection inherits the starting thread's provider,
  model, reasoning level and permission mode. Starting a Flint workflow from a
  Flint thread in `full` mode works.
- Every bb plugin manifest must declare `bb.server`. A Git install of a bb
  plugin runs `npm install --omit=dev --ignore-scripts`, builds the declared
  server entry, and replaces any committed `dist/` with what it builds.
- `bb workflows run --script` returns `{runId, name, status}` and no preview
  directive. `--file` only accepts paths inside the origin workspace, so a
  plugin's script has to be submitted inline.
- In OpenCode, the existing `OpenCodeAdapter` already does what workers need:
  create a session with caller-assigned IDs, submit a prompt with no automatic
  retry, reconcile an uncertain submission, observe the session cheaply while it
  is busy, and interrupt it with confirmation. `resolveOriginModel`,
  `connectToHost` and the context hook that strips the loop tool from workers
  also exist and are kept.

## Goals / Non-Goals

**Goals:**

- The loop's behaviour lives in one file that both hosts run unchanged.
- Keep host-specific code to the minimum each host needs to run `agent()`,
  start, stop and report.
- Reuse the existing OpenCode session code instead of rewriting it.

**Non-Goals:**

- These are deferred until a run shows they are needed:
  - surviving a host restart;
  - persisted run state and status queries;
  - checks run by the plugin itself;
  - stall detection;
  - enforcing bb's permission mode;
  - hiding the skill from bb workers;
  - fixer disputes;
  - having the next verifier recheck earlier issues.
- Running both plugins side by side in one bb install.

## Decisions

### 1. The shared loop is a bb workflow script in the bb skill directory

The script lives at `skills/openspec-verify-loop/verify-loop.js`, in bb workflow
format: a literal `export const meta`, a body with top-level `await`, and a
top-level `return`.

- **bb:** bb stages the whole skill directory on the checkout host, so the
  skill's agent can `cat` the file into `bb workflows run --script`.
- **OpenCode:** the plugin reads the same file relative to `import.meta.url`
  (`../skills/openspec-verify-loop/verify-loop.js` from `dist/index.js`).

Alternatives considered:

- A pure decision engine with a workflow generated around it. This needs a
  build step, drift checks and two execution drivers.
- A controller in the bb plugin backend that spawns threads. This loses the
  Workflows UI, history and restart recovery, and the bb server may not run on
  the checkout host.

The script is the only place that decides rounds, verdicts and prompts.

### 2. The script's control flow and verdict parsing

The script works as follows:

- **Round limit:** `max = min(args.maxRounds ?? 5, floor((budget().maxAgentCalls + 1) / 2))`.
- **Each round:**
  1. Run a verifier.
  2. If the reply's last non-empty line matches `VERDICT: BLOCKED (.+)`, return
     `blocked`.
  3. If the reply is clean (rule below), return `clean`; if it is unverified
     (rule below), return `unverified`.
  4. If this is round `max`, return `limit`.
  5. Otherwise run a fixer with the full report. If the fixer's reply ends with
     `VERDICT: BLOCKED`, return `blocked`.
- **Clean rule:** the last line is `VERDICT: CLEAN`, and the report matches
  neither `\b[1-9]\d*\s+(critical|warning|suggestion)` nor a check marked
  `Not verified` (case-insensitive) at a line start, in a table cell or after a
  colon. The words quoted mid-sentence, as when a report describes this rule,
  do not count. This catches the contradictions the verify skill's own
  final-assessment wording would expose.
- **Unverified rule:** the last line is `VERDICT: UNVERIFIED`, the report has
  no nonzero severity count, and at least one check is marked `Not verified` by
  the same match. The verify skill calls `Not verified` a limit of the report,
  not an archive prerequisite, and forbids inventing optional artifacts to get a
  clean report (its `SKILL.md:73`), yet it marks Design Adherence `Not verified`
  for every change without `design.md`. Sending such a report to a fixer made
  fixers write `design.md` after the fact, so the loop stops instead, and the
  fixer prompt forbids creating optional artifacts to satisfy a check. A
  verdict line the report contradicts goes to the fixer as issues.
- **Change name:** taken from `args.change`. Otherwise it comes from round 1's
  report via `^#{1,6}\s*Verification Report:\s*(\S+)`. If neither is available
  when a fixer would be needed, the script returns `blocked` instead of starting
  it; a clean or final-round result without a title reports `change: null`.
- **Prompts:** one shared rules block, appended to the role-specific text.
  The verifier text also accepts a manual check that the repository records
  (date, run, outcome) when no later change alters the behaviour the check
  exercised, because workers cannot re-run checks on other hosts and the clean
  rule would otherwise never pass for a change with manual checks. Staleness
  follows behaviour, not files: an earlier "nothing it covers changed" wording
  made every edit to `verify-loop.js`, even a prompt sentence, invalidate host
  runs that exercised worker creation, notices and stop.
  `args.store` and `args.procedurePath`, when present, go into the prompts
  verbatim.
- **Errors:** the script does not catch errors from `agent()`. A failed worker
  ends the run, and each host reports the error natively: the Workflows run
  fails on bb, and the runner's failure notice is sent on OpenCode.
- **Result:** `{status, change, rounds, reason, report}`, where `report` is the
  last worker's reply. The full history stays in the hosts: the Workflows
  history on bb, and the worker sessions on OpenCode.

The alternative for clean detection was a structured result schema. It was not
chosen because bb would need `bb_workflow_result` and OpenCode a matching result
tool. A verdict line costs nothing on either host.

### 3. OpenCode loads the script the way Workflows runs it

The loader works in three steps:

1. Replace the leading `export const meta =` with `const meta =`.
2. Build an `AsyncFunction` with parameters `agent, phase, log, args, budget,
   Date, Math, process, require, fetch`.
3. Call it with the host functions, `undefined` for `Date`, `process`, `require`
   and `fetch`, and a frozen copy of `Math` without `random`.

This gives top-level `await` and `return`, and makes the known-forbidden globals
fail on OpenCode, as they do on bb. Tests run the script through this same
loader.

The loader mirrors only the restrictions observed so far. bb's validator is the
authority, so the exact script goes through `bb workflows validate --script` as
a manual check.

The alternative was evaluating the script in a `node:vm` context. That is more
isolation than needed for the plugin's own file, and it still would not
reproduce QuickJS exactly.

### 4. OpenCode `agent()` wraps the existing adapter

Each call does the following:

- **Assignment:** builds one from fresh `ses_` and `msg_` IDs. The role is
  derived from `opts.phase` (`Verify` → verifier, otherwise fixer). The model is
  the pinned origin model, the agent is `build`, and the permissions come from
  `workerPermissions(role)`.
- **Session:** calls `ensureSession`, which records the run ID in session
  metadata so the existing context hook keeps the loop tool away from workers.
- **Submission:** calls `ensurePrompt(a, true)` once. If that throws, it calls
  `ensurePrompt(a, false)` to reconcile by input ID. If reconciliation also
  fails, the call fails: no resubmission.
- **Waiting:** polls `observe` every 2 seconds until the session is no longer
  `running`. `observe` downloads the transcript only once the session looks
  idle. The 2-second interval is a judgement call.
  - `completed`: return the final text.
  - `awaiting_input`: interrupt the session, then fail with a `blocked` error
    naming the session and the request.
  - `failed` or `interrupted`: fail.
- **Abort:** on stop or unload, the run's `AbortSignal` interrupts the current
  session and rejects the pending call.

Permissions:

- Verifiers keep `edit: deny`.
- Every worker keeps `subagent: deny` and `openspec_verify_loop: deny`.
- The verifier's `shell: ask` rule and its allowlist are dropped, because
  verifiers now run tests themselves. Edits made through the shell are blocked
  only by the prompt rule.

The alternative of rewriting session handling was rejected. The existing adapter
already handles the 2.2.5 duplicate-input behaviour and lost responses, and its
tests stay.

### 5. A small in-memory run manager replaces the controller

The manager holds `Map<checkout, {runId, abort, promise}>`:

- **start:** refuses when the checkout already has an entry.
- **stop:** aborts the entry, waits for its promise, and reports `stopped`.
- **Plugin dispose:** aborts every entry and awaits their promises, so the
  active workers are interrupted before unloading completes.
- **When a run ends:** the manager sends one queued notice with the result. The
  notice is sent only while the plugin is loaded, as today.

There are no state files, reservations, resume or status. The `status` and
`resume` actions and their commands are removed.

### 6. bb packaging uses an empty server entry next to the OpenCode bundle

`package.json` gains:

```json
"bb": { "name": "OpenSpec verify loop", "description": "…", "branding": { "icon": "Workflow" }, "server": "./bb/server.ts" }
```

bb's manifest schema requires `branding`; installation fails without it.

- **Server entry:** `bb/server.ts` is `export default function plugin(): void {}`.
  It imports nothing, so it needs no bb SDK dependency.
- **Skills:** the default skill root, `skills/`, provides `openspec-verify-loop`.
- **The OpenCode bundle stays at `dist/index.js`.** A bb Git install replaces
  `dist/` with its own server build, which drops the OpenCode bundle from that
  install only. bb never loads it, so this is harmless. Moving the bundle out of
  `dist/` would also touch `exports`, the bundle script, CI and AGENTS.md for no
  user-visible gain.
- **Runtime dependencies on bb:** `npm install --omit=dev` also installs the
  OpenCode runtime packages and zod there, unused. This is accepted rather than
  splitting packages.
- **Plugin ID:** the bb plugin ID comes from the package name,
  `openspec-verify-loop`. `bb-openspec` provides a skill with the same name, so
  the README tells bb users to uninstall it first.

The alternative was two packages, one per host. That doubles release work while
the shared script is one file.

### 7. Two skill texts under one skill name

- **bb:** `skills/openspec-verify-loop/SKILL.md`. It tells the agent to:
  1. find the absolute path of `openspec-verify-change/SKILL.md` in its skill
     list, falling back to `bb skill list --json`;
  2. write the arguments JSON to `$BB_THREAD_STORAGE`;
  3. run `bb workflows run --script "$(cat <dir>/verify-loop.js)" --args "$(cat <args file>)" --json`;
  4. post `::workflow-preview{run="<runId>"}` and end the turn;
  5. report the result on the done notice, without relaunching;
  6. stop with `bb workflows stop`.

  It also states the `auto`/`full` precondition.
- **OpenCode:** `opencode/SKILL.md`, outside bb's skill root. The OpenCode
  plugin registers it as `openspec-verify-loop`; it describes the `run` and
  `stop` tool actions.

## Risks / Trade-offs

Several of these risks come from upstream bb, OpenCode and OpenSpec behaviour.
Their current status, tracking issues and workarounds are kept in
`docs/known-issues.md` at the repository root, which outlives this change.

- **False clean.** The verifier can write `VERDICT: CLEAN` while issues remain.
  Mitigation: the report check in decision 2. A full report parser (C27 in
  `docs/future-improvements.md`) waits until a false clean is seen.
- **A bb worker asks instead of blocking.** The question reaches no one and the
  run hangs until Workflows' 24-hour timeout. Mitigation: the no-question rule
  plus `VERDICT: BLOCKED`, and the user can stop the run from the preview.
  Detection (C40) waits for an observed stall.
- **A bb thread in `accept-edits` mode.** Its workers stall on shell approvals.
  Mitigation: the precondition is documented in the skill and the README; there
  is no enforcement in the MVP.
- **bb's install may treat the committed `dist/index.js` differently from what
  its docs say.** Mitigation: the manual bb install check. The fallback is
  moving the OpenCode bundle out of `dist/`.
- **The loader differs from QuickJS.** Mitigation: the manual
  `bb workflows validate --script` check.
- **OpenCode restarts mid-run.** The run is lost; the user starts it again.
  Unloading interrupts the active worker, but a crash can leave a worker
  session running.
- **bb completion notices are capped at 16 KiB.** A long final report may be
  truncated. Mitigation: the skill reads `bb workflows status`, or points to
  the preview.

## Migration Plan

Not applicable: backward compatibility is not required, so there is no migration or rollback path.
