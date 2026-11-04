# Tasks

## 1. Hide the skill from bb workflow workers

- [x] 1.1 In `bb/server.ts`, make the default export take the plugin API (declared as a local type with only `agents.configure` and the context's `origin.pluginId`) and register a `configure` callback that returns `{tools: [], skills: []}` when `origin.pluginId` is `"workflows"`, and `{tools: [], skills: ["openspec-verify-loop"]}` otherwise. Replace the "registers nothing" comment with one line on why. Verify with 1.2 and `npm run typecheck`.
- [x] 1.2 Add `tests/bb-server.test.ts`: call the default export with a fake `bb` that captures the callback. Assert the exact return value for a `workflows` origin, and for `null`, `side-chat` and another plugin's origin. Assert that the skill id equals the `name` in `skills/openspec-verify-loop/SKILL.md`'s frontmatter. Verify `npx tsx --test tests/bb-server.test.ts` passes.
- [x] 1.3 Update the docs for the hidden skill, and verify each matches this change's `bb-integration` spec by reading it:
  - `AGENTS.md`: the worker invariant says that on bb the server entry hides the skill from workflow workers, and the shell stays reachable.
  - `docs/known-issues.md`: rewrite the "Thread identity is not authenticated" entry's "Effect on the plugin" and "Mitigation" for the hidden skill and the prompt rule, leaving C41 as the open part.
  - `docs/future-improvements.md`: remove the C13 row.
  - `docs/verification.md`: add the bb server test to the automated coverage list, and add a manual bb step that checks a worker's skill list.
  - `README.md`: one sentence in the bb section saying workers do not see the skill.

## 2. Shared no-loop rule

- [x] 2.1 In `skills/openspec-verify-loop/verify-loop.js`, add a line to the shared `rules` list telling the worker to do its task itself: not use a verify-loop skill, not start or stop loops or workflows, and not delegate to other agents. Verify with 2.2.
- [x] 2.2 In `tests/loop.test.ts`, extend the worker-rules test to assert that every verifier and fixer prompt carries the no-loop rule. Verify `npx tsx --test tests/loop.test.ts` passes.
- [x] 2.3 Update the worker rules in `README.md` and the loop-script coverage list in `docs/verification.md`. Verify by reading that they match this change's `verification-loop` spec.

## 3. Checks

- [x] 3.1 Run `npm run check`, then `git diff --exit-code -- dist/index.js`, and verify both succeed.
- [x] 3.2 Run `bb workflows validate --script "$(cat skills/openspec-verify-loop/verify-loop.js)" --json`, verify it reports `"valid": true` and `literalSelections: []`, and record the result in the `docs/verification.md` table.
- [x] 3.3 Manual bb run, recorded in the `docs/verification.md` table:
  - Install the plugin from this checkout's path with `bb plugin install`.
  - Start a loop from an `auto` thread on a throwaway change.
  - Verify the run's new staged catalogs: the worker catalogs (those without `workflows`) do not list `openspec-verify-loop`.
  - Verify that a new user thread still lists it, and that the run still reaches a verdict.
