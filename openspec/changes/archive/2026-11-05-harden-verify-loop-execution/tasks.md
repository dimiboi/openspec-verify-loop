# Tasks

## 1. Worker ownership and confirmed cleanup

- [x] 1.1 Retain the active worker identity and cleanup operation across the existing runner/service/manager boundary, and route failed observation, permission waits and uncertain admission through cleanup. Verify with fake-adapter tests that cleanup is attempted, no next worker starts, original failure context is retained, and every prompt is submitted at most once.
- [x] 1.2 Keep the checkout reservation after cleanup returns false or throws, and let a later explicit stop retry the retained worker after execution has settled. Verify manager tests for refused starts, failed retry, successful retry releasing ownership, and concurrent callers sharing one in-flight cleanup attempt without background retries.
- [x] 1.3 Make adapter cleanup attempt active-session interruption even if inbox inspection/cancellation fails, and require confirmed inactivity before success. Verify fake-client cases for inbox failure, remaining queued input, false confirmation, missing session, and interruption request failure.
- [x] 1.4 Document failed-cleanup reservation and explicit retry in README.md and opencode/SKILL.md, and add the group's deterministic coverage to docs/verification.md. Verify the documented stop action and outcome wording match the fake-host cases above.

## 2. Cancellation, replies and unload

- [x] 2.1 Check cancellation across session creation, in-flight admission, observation and terminal result commitment. Verify deferred-promise tests for stop before dispatch, stop during final observation, reconciled dispatch during stop, and stop after committed completion; assert no contradictory clean/stopped results or duplicate prompt submission.
- [x] 2.2 Preserve one terminal run notice while answering each later cleanup retry, including the origin session. Verify command/tool integration tests for initial failed stop, repeated failed stop, successful cleanup retry, and stops from another session; check notice counts and tool-less reporting.
- [x] 2.3 Make manager/plugin close clean retained workers as well as executing ones, reject unconfirmed cleanup without prematurely disposing controls, and allow retry after a rejected cleanup promise. Verify plugin tests that failed unload keeps cleanup reachable and replies deliverable, a later cleanup succeeds, registrations dispose once, and new starts remain refused while closing.
- [x] 2.4 Update docs/verification.md with the cancellation and unload checks. Manually verify normal stop and unload on OpenCode 2.2.5 and its response to rejected cleanup using an isolated checkout; record date, host version, worker/run identity and outcome separately from fake-host evidence, and document any host-forced-unload limitation in docs/known-issues.md. Keep this task unfinished if the manual check cannot run; do not start, replace or stop an OpenCode service.

## 3. Invoking directory and checkout identity

- [x] 3.1 Resolve the invoking effective directory from location/subpath for catalogue discovery, worker creation and worker identity validation, using the canonical Git root only for the reservation. Verify fake-session tests for direct nested directories and root-plus-subpath representations while preserving permission, metadata and model mismatch rejection.
- [x] 3.2 Add temporary nested Git/OpenSpec fixtures and canonical alias cases to verify the nested change remains visible, sibling/alias starts share the checkout reservation, and a sibling stop cleans the original worker without changing its directory. Verify these tests use fake host/model adapters only.
- [x] 3.3 Document nested-project behavior in README.md and docs/verification.md, then manually confirm the OpenCode 2.2.5 location/subpath round-trip in an isolated nested project. Record the effective worker directory, nearest OpenSpec root, date and outcome; keep this task unfinished if native verification is unavailable.

## 4. Shared count matching and unused parser removal

- [x] 4.1 Normalize simple Markdown emphasis/code marks only for severity-count matching in the shared verify-loop.js. Verify parameterized loop tests for emphasized numbers and critical/warning/suggestion words, contradicted CLEAN and UNVERIFIED verdicts, zero counts, and the existing Final Assessment and quoted-status behavior.
- [x] 4.2 Delete parseModel(), its test import and its dedicated test after confirming whole-tree references. Verify type checking and the existing invoking-model tests still pass with no replacement parser.
- [x] 4.3 Update docs/verification.md to describe the new count-format coverage. Verify the examples match the loop tests and that no unsupported general report parser or live-host evidence is claimed.

## 5. Integration validation

- [x] 5.1 Use Node.js >=22.18 and npm ci, then run npm run check. Verify types, the generated dist/index.js, all deterministic tests and package validation pass, host SDK/runtime imports remain external, and the suite starts no model calls or OpenCode sessions.
- [x] 5.2 Validate the exact modified skills/openspec-verify-loop/verify-loop.js with bb workflows validate --script and record the valid result in docs/verification.md without starting a workflow.
- [x] 5.3 Run openspec validate harden-verify-loop-execution --strict and review the final diff against both delta specs. Verify all six audit findings are addressed and that no deferred automatic retries, persistent locks, new dependencies/configuration or unrelated changes were introduced.
