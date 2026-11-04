# Tasks

## 1. Shared loop script

- [x] 1.1 Add `src/loop.ts` with the script loader from design decision 3. It strips the literal `export const meta =`, runs the body as an `AsyncFunction`, and passes `undefined` for `Date`, `process`, `require` and `fetch` and a frozen `Math` without `random`. Verify with the loader cases in 1.3.
- [x] 1.2 Write `skills/openspec-verify-loop/verify-loop.js` with the control flow, verdict parsing, clean rule, change-name rule, shared worker rules block and `{status, change, rounds, reason, report}` result from design decision 2. Verify with 1.3, and confirm by reading that the file uses only `agent`, `phase`, `log`, `args` and `budget`.
- [x] 1.3 Add `tests/loop.test.ts`, which runs the script through the loader with a fake `agent()`. Verify `npx tsx --test tests/loop.test.ts` passes these cases:
  - clean on round 1;
  - fix then clean;
  - `limit` at `maxRounds` with no fixer after the last verification;
  - a small `budget()` lowers the round limit;
  - a blocked verifier, and a blocked fixer;
  - `VERDICT: CLEAN` contradicted by "2 warning(s)", and by `Not verified`;
  - a given change and store reach every prompt unchanged;
  - the change name is taken from round 1's report title;
  - a missing report title gives `blocked`;
  - verifier prompts carry the no-edit rule and fixer prompts do not;
  - every prompt carries the exit-code, no-commit-or-archive and no-question rules;
  - a script calling `Date.now()` fails.
- [x] 1.4 Rewrite the loop invariants in `AGENTS.md` for the shared script: fresh sequential workers, the verdict-based clean rule, no prompt resubmission, and workers that cannot start loops. Remove the pinning, reservation and persisted-dispatch rules. Verify by reading that no remaining rule refers to a removed mechanism.
- [x] 1.5 Update `docs/loop-roadmap.md` so wave 1 lists the MVP capabilities this change delivers. Move the deferred wave 1 items into an "add when a run shows the need" list, each with its trigger. Verify the scored table still matches every quadrant. The roadmap was later replaced by `docs/future-improvements.md`, which keeps the deferred list and its triggers.
- [x] 1.6 Add the recorded-manual-check rule to the verifier prompt, with a loop test that verifier prompts carry it and fixer prompts do not. Found when two bb loop runs on this change blocked on manual host checks recorded in `docs/verification.md`.
- [x] 1.7 Count `Not verified` in the clean rule only where a report marks a check (line start, table cell or after a colon), with loop tests for a quoted mention and three marked forms. Found when a clean bb verification of this change quoted the rule itself.
- [x] 1.8 Add the `unverified` status: the verifier's `VERDICT: UNVERIFIED` line plus a report with no nonzero severity count and at least one `Not verified` check ends the run without a fixer, and the fixer prompt no longer asks to fix unverified checks and forbids creating optional artifacts to satisfy one. Add loop tests for the stop, the stop on the last round, three disagreements between verdict and report, and the per-role prompt rules. Found when fixers on Claude, local Flint and Codex wrote a `design.md` to clear a Not verified Design Adherence check on a change that rightly had none (see `docs/known-issues.md`).
- [x] 1.9 Tie a recorded manual check's staleness to the behaviour it exercised, not to the files it touched, in the verifier prompt, with the loop test checking the new sentence. Found when task 1.8's prompt change would have made every recorded host run stale although none of the host behaviour they exercised changed.

## 2. OpenCode front

- [x] 2.1 Reduce `src/workers.ts` to the rules in design decision 4:
  - verifier: `edit: deny`;
  - every worker: `subagent: deny` and `openspec_verify_loop: deny`;
  - remove the shell `ask` rule, its allowlist and `workerPolicyDigest`.

  Update the permission assertions in `tests/opencode.test.ts` and verify they pass.
- [x] 2.2 Add `src/runner.ts`, implementing `agent()` on `OpenCodeAdapter` as in design decision 4: an assignment derived from `opts.phase`, one submission followed by reconciliation, polling `observe` every 2 seconds, interrupting and failing as `blocked` on `awaiting_input`, and interrupting on abort. Add `tests/runner.test.ts` with fake clients and verify it covers:
  - exactly one prompt submission;
  - a lost response reconciled without resubmission;
  - an invisible submission that fails with no second prompt;
  - a permission request that interrupts the worker and names the session;
  - abort interrupting the session;
  - verifier sessions created with the verifier permissions.
- [x] 2.3 Replace `src/manager.ts` with the in-memory manager from design decision 5: start refuses a second run in the checkout; stop aborts the run and reports `stopped`; close aborts every run and awaits it; one notice is sent per run that ends. Rewrite `tests/manager.test.ts` to verify those four behaviours, including a plugin dispose that interrupts the active worker.
- [x] 2.4 Reduce `src/service.ts`, `src/config.ts`, `src/tools.ts` and `src/commands.ts`:
  - tool actions: `run`, with optional `change`, `store` and `maxRounds`, and `stop`;
  - commands: `/opsx-verify-loop [change]` and `/opsx-verify-loop-stop`;
  - options: `server` and `maxRounds`;
  - the origin model is resolved with no role overrides and checked against the catalogue with the `default` variant rule;
  - exactly one `openspec-verify-change` skill path is required.

  Update `tests/plugin.test.ts` and verify it covers:
  - the model after a session model switch;
  - an unavailable model refused with no substitute;
  - a missing verify skill, and duplicate verify skills, refused;
  - a worker session rejected by the tool;
  - command parsing.
- [x] 2.5 Write `opencode/SKILL.md` for the `run` and `stop` actions, and point the skill registration in `src/plugin.ts` at it. Keep the OpenCode version check, the context hook and the tool-less notice. Verify with `tests/plugin.test.ts` and `node scripts/validate-plugin.mjs`.
- [x] 2.6 Delete the controller and its tests, then trim `src/util.ts` and `package.json`:
  - source: `src/controller.ts`, `state.ts`, `reports.ts`, `prompts.ts`, `summary.ts` and `openspec.ts`;
  - tests: `controller`, `state`, `reports`, `prompts`, `progress`, `context-integration` and `openspec`, plus `fixtures.ts` if it is now unused;
  - `src/util.ts`: trim to what the remaining code imports;
  - `package.json`: remove `@fission-ai/openspec` if unused, and set the version to 0.4.0, matching `VERSION`.

  Verify `rg "controller|reports|prompts|summary|openspec\\.js|state\\.js" src tests` finds no stale imports and `npm run check` passes. A later verification removed what this trim left behind: the unused `VERSION` and the check-runner `command()` helper, replaced by `execFile` in `projectRoot`, with its test.
- [x] 2.7 Rewrite the README's OpenCode section: install, `/opsx-verify-loop`, `/opsx-verify-loop-stop`, the remaining options and OpenCode 2.2.5. Update the automated-suite description in `docs/verification.md`. Verify by reading that the documented names match those registered in `src/commands.ts` and `src/tools.ts`.
- [x] 2.8 Rename the OpenCode commands to `/opsx-verify-loop` and `/opsx-verify-loop-stop`, matching OpenSpec's `/opsx-*` commands in OpenCode. Verify with `tests/plugin.test.ts` and on OpenCode 2.2.5 that both new names are registered and handled.
- [x] 2.9 Close the gaps from a manual `/opsx:verify`: test that the plugin refuses OpenCode versions other than 2.2.5, specify which session receives the stop notices, and align `design.md` with the code on the change-name rule and the bb manifest's `branding` field. Verify with `npm run check` and `openspec validate --strict`.
- [x] 2.10 Close the gaps from a scenario-by-scenario `/opsx:verify`: a loop test that a failed worker ends the run with no further worker, guards for prompt- and skill-only scenarios (ambiguous change; `--store`, `--max-rounds`, `bb workflows status` and `bb workflows stop` in the bb skill), and the recorded `--max-rounds` pass-through. Verify with `npm run check`.

## 3. bb front

- [x] 3.1 Add the `bb` manifest to `package.json` (`name`, `description`, `server: "./bb/server.ts"`) and `bb/server.ts` exporting an empty default plugin function. Add `bb/**/*.ts` to `tsconfig.json` and `bb` to `files`. Verify `npm run typecheck` passes.
- [x] 3.2 Replace `skills/openspec-verify-loop/SKILL.md` with the bb skill from design decision 7. It covers:
  - finding the procedure path;
  - writing the arguments file;
  - `bb workflows run --script … --args … --json`;
  - the preview directive, then ending the turn;
  - reporting the completion notice without relaunching;
  - `bb workflows stop`;
  - the `auto`/`full` precondition, including Flint's need for `full`.

  Delete `skills/openspec-verify-loop/references/report-contract.md`. Verify the frontmatter name is `openspec-verify-loop`.
- [x] 3.3 Update `scripts/validate-plugin.mjs` and `tests/package.test.ts` for the new layout. Required files: `dist/index.js`, `bb/server.ts`, `skills/openspec-verify-loop/SKILL.md`, `skills/openspec-verify-loop/verify-loop.js` and `opencode/SKILL.md`. Checks:
  - the `bb` manifest has `name`, `description` and `server`;
  - the bb skill mentions `bb workflows run --script` and the `auto`/`full` precondition;
  - the OpenCode skill names `openspec_verify_loop`.

  Verify `npm run check`, including the Git-packaging test.
- [x] 3.4 Add the README's bb section:
  - uninstall `bb-openspec` first;
  - `bb plugin install` of this repository;
  - enable the Workflows plugin;
  - start from an `auto` or `full` thread, with `full` for local Flint;
  - `/openspec-verify-loop [change] [--store id] [--max-rounds n]`, and stopping.

  Add the manual bb checks to `docs/verification.md`. Verify by reading that it matches the bb skill text.

## 4. Integration checks

- [x] 4.1 Run `npm run check` and `git diff --exit-code -- dist/index.js` after the bundle, and verify both succeed.
- [x] 4.2 Run `bb workflows validate --script "$(cat skills/openspec-verify-loop/verify-loop.js)"` (manual; needs the bb CLI). Verify it reports `"valid": true`.
- [x] 4.3 Manual bb run:
  - install the plugin after removing `bb-openspec`;
  - from a Claude thread in `auto`, run `/openspec-verify-loop` on a change with known issues;
  - confirm that one preview is posted, that workers use the thread's model, that the run ends `clean` or `limit` after a fix and a fresh verification, and that the completion report starts no new run;
  - stop a second run with `bb workflows stop`.
- [x] 4.4 Manual bb run on local Flint, started from a Flint thread in `full`. Confirm that workers run on Flint and that the run reaches a verdict.
- [x] 4.5 Manual OpenCode 2.2.5 run:
  - install from Git (waived until the branch is pushed; loaded from the checkout path);
  - run `/opsx-verify-loop` on a change with known issues;
  - confirm that workers use the invoking model, that the notice reports the result, and that `/opsx-verify-loop-stop` interrupts an active worker.

## Workflow follow-up

- Verify the change with `/opsx:verify` and archive it once the manual checks pass.
