# Tasks

## 1. Pi entry and package compatibility

- [x] 1.1 Add the Pi extension source under `src/`, a generated `dist/pi.js` entry and explicit Pi resource metadata; keep host SDK/runtime dependencies external and the bb-specific skill excluded on Pi. Extend `scripts/validate-plugin.mjs` and `tests/package.test.ts` to verify both bundles, existing exports, inert extension loading and Git installation without preparation scripts.
- [x] 1.2 Pin the tested Pi Durable/Chord runtime versions, declare Pi-provided SDK packages as optional peers, and raise Node metadata to >=22.19. Verify `npm ci`, public import/type compatibility and absence of an installed duplicate host SDK; document tested versions, Pi installation and the Node change in README and repository development guidance.

## 2. Invoking context and fresh workers

- [x] 2.1 Implement Pi input validation, invoking directory/canonical checkout resolution and verify-skill discovery from command provenance. Add fake-host cases for nested projects, aliases, invalid inputs, missing/ambiguous skills and non-Git directories; verify no worker is created when preflight fails.
- [x] 2.2 Implement the typed public provider/auth bridge from Pi to Durable, capturing the starting model and effective thinking level and resolving credentials at request time. Verify custom provider endpoints/headers, credential refresh, later parent model changes and missing-model/auth failures with fake providers; confirm persisted metadata contains no credentials.
- [x] 2.3 Create fresh Durable worker conversations with project context and explicit role tool lists, returning only complete correlated answers. Test distinct sequential workers, full report transfer, inherited instructions/settings, unavailable loop/delegation tools and unsuccessful/truncated worker outcomes. Document tool scope and the shell's prompt-only restrictions in README.

## 3. Durable state and shared-script replay

- [x] 3.1 Add the checkout-namespaced JSONL store outside the working tree, versioned run/call records and coordinator task, plus an atomically published report snapshot that viewers read without opening the authoritative store. Verify snapshots cannot modify the live store, and reopen preserves complete settings, identities, replies and terminal results, and that records leave the fixture checkout unchanged; document the state location and retained content.
- [x] 3.2 Persist worker creation with its call identity and prompt admission with its submission receipt using atomic commits. Inject failures before/after admission and lost responses; verify reconciliation by saved identity, no resubmission and no replacement worker when admission cannot be correlated.
- [x] 3.3 Bind the existing `runScript()` to the journaled `agent()` adapter without changing `verify-loop.js`. Test replay after completed verification/fix calls and during a pending call, exact prompt/role matching, the original arguments and call budget, and the final-verification rule; assert completed workers are not executed again.
- [x] 3.4 Implement recovery checks for loop hash, record/task versions, original directory/checkout, procedure content and model/thinking/auth availability. Test mismatches and divergence preserve reports and cleanup access while scheduling no worker; document recovery compatibility errors.

## 4. Exclusive ownership and lifecycle cleanup

- [x] 4.1 Add exclusive Pi process ownership per canonical checkout, with token-protected acquisition/release and retained unfinished-run reservations. Test two independent owners, sibling directories, symlink aliases, stale/uncertain identities and successful release; verify a live or uncertain owner prevents writable takeover.
- [x] 4.2 Supervise the Node execution environment and retain sufficient active-command identities for cleanup/recovery. Use local subprocess tests to verify normal cancellation, parent-process interruption, descendant cleanup and refusal when old execution cannot be established inactive; retain unsafe tool replay and document partial-edit limitations.
- [x] 4.3 Implement explicit stop intent, owned-task abort, confirmed inactivity and retry of retained cleanup, including stop on an interrupted run. Test that cleanup starts no model/tool work, stop accepted before completion wins, terminal results cannot be resumed, and failed cleanup retains identities and ownership.
- [x] 4.4 Implement idempotent shutdown suspension for quit, reload and session replacement: fence dispatch, save interruption state, close the harness and environments, and await cancellation. Test that closure does not become a terminal worker failure, replacement loading is inert and unconfirmed cleanup remains actionable; record any observed upstream lifecycle limitation in `docs/known-issues.md` without changing existing workarounds.

## 5. Native commands and direct reports

- [x] 5.1 Register start, report, stop and resume commands with optional control run IDs and the specified default selection. Verify start returns before completion, unfinished runs block a new start, running/terminal runs reject resume, cross-checkout targets are refused and explicit resume retains the original run identity.
- [x] 5.2 Render progress, completion and complete saved worker reports using native Pi messages/entries without a model turn. Test a busy parent, repeated reports, session replacement and restart retrieval; assert loading/reporting performs no model request, worker tool call or automatic resume.
- [x] 5.3 Document all four command syntaxes, explicit resume versus terminal stop, setting inheritance, ownership conflicts and cleanup failures in README. Verify examples against parser tests and ensure documented report/recovery behavior matches the command cases.

## 6. Opt-in Pi host checks

- [x] 6.1 Extend `tests/live/common.ts` host/scenario parsing and fixture/evidence helpers only as needed for Pi, and add `tests/live/pi.ts` plus `test:live:pi`. Cover options, normal command dispatch, setup failure, bounded observation, saved evidence and cleanup using fake RPC/process adapters; verify bb/OpenCode helper tests remain valid and `npm run check` cannot enter live execution.
- [x] 6.2 Add fixture-scoped Pi RPC setup using the tested package snapshot, normal native commands and the selected verify procedure. Verify fake-driver cases retain Pi/Durable versions, provider/thinking settings, run/worker/submission identities and full reports while leaving user package configuration unchanged; add Pi prerequisites and invocation examples to `docs/verification.md`.
- [x] 6.3 Implement fix-to-clean and active-worker stop assertions using the existing independent greeting checks, missing-design assertion and cleanup requirements. Test success, missed-stop, unsuccessful convergence, weakened fixture tests and cleanup uncertainty through fake host evidence.
- [x] 6.4 Implement the resume scenario: observe a completed call and an unfinished one, interrupt the owned Pi host, reopen/report inertly and explicitly resume the same run. Test detection of duplicate admissions, repeated workers, budget reset, missing interruption evidence and uncertain prior execution; document the scenario's retained recovery evidence.

## 7. Integration validation

- [x] 7.1 On Node >=22.19 run `npm ci` and `npm run check`, regenerate and retain both committed bundles, and confirm the existing bb/OpenCode deterministic regressions and package checks pass without model calls or real host sessions.
- [x] 7.2 Explicitly run Pi `fix-to-clean`, `stop` and `resume` fixture attempts with an available selected provider/model; record dates, tested versions, run/worker identities, evidence paths, outcomes and cleanup in `docs/verification.md`. An unavailable prerequisite or unexercised scenario must be recorded as unverified and must not be claimed passed.
- [x] 7.3 Validate the final behavior against all three delta specs and run `openspec validate add-pi-durable-support --strict`; verify the final diff preserves the shared loop definition and existing host interfaces, and contains no incidental cross-host recovery or locking changes.
