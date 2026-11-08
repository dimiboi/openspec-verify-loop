# Tasks

## 1. Isolated fixture and independent checks

- [x] 1.1 Add the minimal greeting seed under `tests/live/fixtures/greeting/`, including the active change metadata, known defects, failing tests and absent `design.md`; verify `node --test` fails for the intended defect and the fixture change validates with OpenSpec.
- [x] 1.2 Implement fresh attempt-directory/Git preparation and copying of the supplied installed verify procedure with relative resources and provenance; add deterministic tests proving a second attempt retains the original defects after the first fixture is modified and the committed seed is untouched.
- [x] 1.3 Add controller-owned final greeting checks, fixture-test execution and the absent-design assertion; add deterministic cases where corrected code passes, a weakened fixture test cannot hide a bad greeting, and an invented `design.md` fails.
- [x] 1.4 Document fixture contents, procedure input and the isolation boundary in the live-testing section of `docs/verification.md`; verify the documented baseline and independent-check expectations match the delivered fixture.

## 2. Attempt lifecycle and evidence

- [x] 2.1 Add shared option/deadline handling, attempt identity and incremental raw evidence plus `result.json`/`summary.md` output; verify invalid or missing required inputs fail before host mutation and unsuccessful attempts retain available identities, settings and failure stage.
- [x] 2.2 Implement run-correlated notice reading and bounded collection helpers without duplicating verdict policy; add fake-record tests for start `outcome` versus terminal `status`, multiple pages, queued/delivered notice deduplication, nonadvancing cursors and explicitly incomplete evidence.
- [x] 2.3 Implement bounded cleanup on completion, error, timeout and catchable interruption, with zero exit only after scenario success and confirmed inactivity; use fake host boundaries to verify no repeated start after a lost response, retained artifacts on cleanup failure, and separately recorded native fallback.
- [x] 2.4 Document deadlines, result classifications, evidence fields, retained resources and manual recovery in `docs/verification.md`; verify examples distinguish unsuccessful convergence, a stop that was not exercised and unknown cleanup from a passing attempt.

## 3. bb live driver

- [x] 3.1 Add bb preflight for the explicitly installed checkout, Workflows, provider/model/mode and procedure; record revision/dirty state and source hashes before and after execution, and verify fake CLI tests reject an unexpected installation or changed source without issuing global configuration commands.
- [x] 3.2 Implement the normal fixture-project thread launch through the installed skill and project-scoped workflow/thread observation; add deterministic CLI-record tests proving one launch/preview, correct change/procedure arguments, a launch turn that ends, sequential fresh workers with inherited settings and completion without relaunch.
- [x] 3.3 Implement bb's active-worker stop through a user request to the starting thread, plus separately labeled emergency cleanup; verify fake traces distinguish the normal stop call and confirmed cancellation from natural completion and cleanup-only interruption.
- [x] 3.4 Expose `npm run test:live:bb` and document explicit installation, model/provider/mode selection, both scenarios and evidence review in `docs/verification.md` and README development guidance; verify `--help` is read-only and examples use the fixture project's context rather than the parent project.

## 4. OpenCode live driver

- [x] 4.1 Add complete local package snapshot preparation with manifest, runtime resources, lockfile and externally resolved production dependencies; verify an isolated deterministic packaging check can resolve the snapshot and its relative resources without linking to the source checkout, and the published package still excludes `tests/live/`.
- [x] 4.2 Implement discovery of the existing compatible service, fixture-only configuration, catalogue readiness, selected-model origin creation and single native command dispatch; add fake client tests for empty initial catalogues, missing service/model/procedure, command rather than prompt dispatch, and absence of service-management/global-reload calls.
- [x] 4.3 Implement complete session/inbox observation, worker/model/sequence and notice assertions, reporting-turn inspection and active-worker stop with confirmed inactivity; verify fake traces cover `status` completion, no-tool reporting, later pages, stop racing completion and cleanup failure without resubmission.
- [x] 4.4 Expose `npm run test:live:opencode` and document the existing-service prerequisite, procedure/model input, snapshot and both scenarios; verify `--help` is read-only and replace the stale global-reload advice in `docs/verification.md` with the current scoped-readiness workaround while retaining native unload/fault-injection diagnostics.

## 5. Integration validation

- [x] 5.1 Run `npm ci` and `npm run check` on a supported Node version; verify types, bundle, deterministic harness cases and package validation pass with no live host/model calls and no production loop/prompt changes.
- [x] 5.2 Explicitly run bb fix-to-clean and active-worker stop against the tested installed checkout; retain and review both evidence sets for independent behavior checks, worker identities/settings, public skill reporting and confirmed cleanup, recording unavailable or unexercised checks as unverified rather than passed.
- [x] 5.3 Explicitly run OpenCode fix-to-clean and active-worker stop on the existing service; retain and review both evidence sets for snapshot/procedure provenance, native notices, independent checks and confirmed cleanup, recording unavailable or unexercised checks as unverified rather than passed.
