# Tasks

## 1. Pi minimum version

- [x] 1.1 In `src/util.ts`, add `requirePi(found)` comparing `major.minor.patch` numerically with `PI_VERSION` and throwing "Pi loop requires Pi ${PI_VERSION} or later; found ${found}", with a non-matching version treated as older. Add a test in `tests/pi-service.test.ts` covering 1.5.2, 1.5.3, 1.5.10, 1.6.0, 1.10.0, 2.0.0, 10.0.0 and `1.6.0-beta.1` accepted, and 1.5.1, 1.4.9, `0.0.0` and `abc` refused, checking the full message for 1.5.1; verify with `npx tsx --test tests/pi-service.test.ts`.
- [x] 1.2 In `src/pi-service.ts`, replace the exact checks in start and resume with `requirePi(VERSION)`, leaving report and stop unchecked; verify `git grep -n 'requirePi' src` shows its definition in `src/util.ts` and exactly two calls, in start and resume.
- [x] 1.3 In `tests/live/pi.ts`, replace the exact `assert.equal` on `pi --version` with `requirePi(version)`, and make the fake `pi --version` in `tests/live-pi.test.ts` print `PI_VERSION`; verify `npx tsx --test tests/live-pi.test.ts` passes.
- [x] 1.4 Update `README.md` `## Pi` and the Pi procedure in `docs/verification.md` to "Pi 1.5.2 or later", keeping the note that the recorded live checks ran on 1.5.0 and 1.5.1; verify `git grep -n 'Pi 1.5.2' -- README.md docs/verification.md` shows only "or later" wording outside dated records.

## 2. One source per version

- [x] 2.1 Replace the `'2.2.5'` literals in `tests/plugin.test.ts`, `tests/opencode.test.ts`, `tests/fake-client.ts`, `tests/live-opencode.test.ts`, `tests/live/opencode.ts` and `tests/live/common.ts` with `OPENCODE_VERSION`, including the version inside messages, help text and the test title at `tests/plugin.test.ts:78`, and make the regex expectations at `tests/plugin.test.ts:81` and `tests/opencode.test.ts:132` match on `OPENCODE_VERSION` (for example with `error.message.includes(...)`); keep mismatch tests on a clearly different version; verify `git grep -nE '2\\?\.2\\?\.5|1\\?\.5\\?\.2' -- tests` returns only comments (the Durable note at `tests/durable-readonly.test.ts:81` and the `tests/fake-client.ts` doc comment).
- [x] 2.2 In `tests/package.test.ts`, assert that `@opencode/client` and `@opencode/plugin` equal `OPENCODE_VERSION` and the `@earendil-works/pi-coding-agent` dev pin equals `PI_VERSION`; verify by temporarily changing one pin and seeing the test fail, then restoring it.
- [x] 2.3 In `scripts/validate-plugin.mjs`, replace the `'>=22.19.0'` literal with the first `node:` matrix entry read from `.github/workflows/ci.yml`, with a `shortcut:` comment on the regex; verify by running `node scripts/validate-plugin.mjs`, then temporarily editing the CI floor to see it fail.
- [x] 2.4 Rewrite the AGENTS.md OpenCode and Pi version checklists and the Node floor line to match: change the constant and the pins the package test checks, raise `PI_VERSION` with the SDK dev pin, leave Pi Durable and Chord as separate pins, then grep docs for the old version. The Node floor line becomes: change `engines.node` and the lowest CI `node:` matrix entry together (the validator checks they agree), then `git grep -n '<old floor>' -- . ':!openspec/changes' ':!package-lock.json'` and leave dated records alone. In AGENTS.md:3, keep `.github/workflows/ci.yml` edits out of the suite except a change to its `node:` matrix, which runs `node scripts/validate-plugin.mjs`. Verify each file the checklists name exists.

## 3. Host lists and specs

- [x] 3.1 Make `README.md:290` and `AGENTS.md:36` refer to the upstream bugs without listing hosts, and drop "the known-issues line above" from the AGENTS.md host checklist; verify `git grep -nE 'OpenCode(,| and) (Pi Durable and )?OpenSpec' -- . ':!openspec/changes' ':!docs/known-issues.md'` returns nothing (`docs/known-issues.md` keeps its enumeration).
- [x] 3.2 Confirm the delta specs in this change (`pi-integration` Pi package entry, `verification-loop` Worker failure ends the run) match the implemented behaviour; verify `openspec validate integrate-pi-docs-and-pi-floor --strict` passes.

## 4. Document structure

- [x] 4.1 Restructure `docs/verification.md` as in design.md: coverage bullets back under `## Automated checks`, the live-command sections in the order bb, OpenCode, Pi (the Pi procedure as `### Pi live commands`), every dated record under `## Recorded results` newest first (the 2026-11-09 Pi record as `###`), and one line after that heading saying evidence paths and test counts are as of each record's date. Move dated text verbatim. Update AGENTS.md's "Opt-in Pi checks" reference. Verify with `grep -n '^#' docs/verification.md` against the design layout and `git diff --color-moved` showing record bodies as moves.
- [x] 4.2 Reorder the README host sections to bb, OpenCode, Pi, and rewrite the Development live-test paragraph as one list of `npm run test:live:{bb,opencode,pi} -- --help`; verify `grep -n '^## ' README.md` shows bb, OpenCode, Pi, Development, and every README link still resolves.

## 5. Integration

- [x] 5.1 Run `npm run bundle` and `npm run check` with the same npm cache as `npm ci`, and confirm `git diff --stat -- dist` shows only `dist/pi.js`; run `openspec validate --specs`.
