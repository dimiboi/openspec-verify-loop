# Proposal

## Why

Pi support (`3abb23f`) was added beside the existing material instead of folded into it, and the stale-doc audit (`b066680`) fixed the wording it found but not that cause. A host list in `README.md:290` still omits Pi Durable and is invisible to the AGENTS.md grep; `docs/verification.md` files the automated coverage list under `## Opt-in Pi checks` and keeps a Pi record outside `## Recorded results`; tests type host versions as literals that each bump must find by hand; two main-spec sentences still use change-time wording. Separately, the Pi guard accepts only Pi 1.5.2 exactly, so every Pi patch release, like the 1.5.1 to 1.5.2 drift the audit found, stops the loop until a re-pin.

## What Changes

- Pi start and resume accept Pi 1.5.2 **or later** instead of exactly 1.5.2. An older Pi, or a version string that does not parse, is refused with "Pi loop requires Pi 1.5.2 or later; found <version>". Report and stop stay available on any Pi, as today. The live Pi driver applies the same check. The bundled Pi Durable and Chord pins stay exact; Durable brings its own `pi-ai` 1.5.2, which can differ from a newer host's, and an observed failure there is the trigger to raise those pins.
- Host versions come from one place: tests and live drivers use `OPENCODE_VERSION` and `PI_VERSION` from `src/util.ts` instead of literals. A package test asserts the `@opencode/*` pins and the Pi SDK dev pin equal those constants, and the package validator reads the Node floor from the CI matrix instead of repeating it.
- Host lists are stated where they are needed only: `README.md:290` and `AGENTS.md:36` stop enumerating hosts, and the AGENTS.md host and version checklists shrink to match. The Node floor checklist ends with a grep like the version checklists, and AGENTS.md no longer exempts a CI `node:` matrix edit from validation.
- `docs/verification.md` is restructured without changing any dated record's text: the live-command sections run bb, OpenCode, Pi, with the Pi procedure as `### Pi live commands`, the automated coverage list returns under `## Automated checks`, the Pi records move under `## Recorded results`, records run newest first, and one line notes that evidence paths and counts are as of each date.
- README host sections follow the order used everywhere else, bb, OpenCode, Pi, and the live-test paragraph covers all three hosts in one list.
- Main specs lose change-time wording: "Existing bb and OpenCode failure handling SHALL remain unchanged" is removed, and "The existing bb entry and OpenCode default export SHALL remain available" states the requirement directly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pi-integration`: Pi package entry gains the minimum Pi version for start and resume, and states the other hosts' entries without change-time wording.
- `verification-loop`: Worker failure ends the run drops a sentence that only made sense inside the Pi change.

## Impact

- `src/util.ts`, `src/pi-service.ts`: `PI_VERSION` becomes the minimum, checked by one `requirePi` helper that also owns the refusal message; `dist/pi.js` is rebuilt.
- `tests/`: version literals replaced by the constants (`plugin`, `opencode`, `fake-client`, `live-opencode`, `live-pi`, `live/opencode`, `live/pi`); a test for the comparison; pin assertions in `tests/package.test.ts`.
- `scripts/validate-plugin.mjs`: Node floor read from `.github/workflows/ci.yml`.
- Docs: `README.md`, `AGENTS.md`, `docs/verification.md`.
- No change to `verify-loop.js`, run records, bb or OpenCode behaviour, or package dependencies.
