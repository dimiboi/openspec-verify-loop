# Design

## Context

See proposal.md for why. Current state that shapes the approach:

- `src/pi-service.ts:71,99` refuse start and resume unless `VERSION` from `@earendil-works/pi-coding-agent` equals `PI_VERSION` (`src/util.ts:8`). Report and stop have no check. No test covers the guard.
- `@earendil-works/pi-coding-agent` and `pi-ai` are optional peers (`"*"`) that Pi supplies at runtime; the type check and tests run against the `pi-coding-agent` dev pin (1.5.2). Pi Durable and Chord are the plugin's own dependencies, pinned at 1.5.2 and installed with it, so the run store's format belongs to the plugin. They are not cut off from the host's Pi: Durable itself depends on `@earendil-works/pi-ai` 1.5.2 (`node_modules/@earendil-works/pi-durable/package.json`), while Pi's extension loader aliases the plugin's `pi-ai` and `pi-coding-agent` imports to the host's copies (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:66-73`), and the plugin hands host-side models (`createModels()`, `ctx.modelRegistry`) to Durable.
- Pi exposes `VERSION = pkg.version || "0.0.0"` (`node_modules/@earendil-works/pi-coding-agent/dist/config.js:493`).
- `semver` is installed only as a transitive dependency of `pi-coding-agent`.
- Version literals: `'2.2.5'` in `tests/plugin.test.ts`, `tests/opencode.test.ts`, `tests/fake-client.ts`, `tests/live-opencode.test.ts`, `tests/live/opencode.ts`, `tests/live/common.ts`; the same version inside regex expectations, `/requires OpenCode 2\.2\.5/` (`tests/plugin.test.ts:81`) and `/2\.2\.5 is required; .../` (`tests/opencode.test.ts:132`), and in the test title at `tests/plugin.test.ts:78`; `'1.5.2'` in `tests/live/pi.ts:122` and `tests/live-pi.test.ts:42`. `tests/live/pi.ts` already imports from `src/`; `tests/live/opencode.ts` imports nothing from `src/` yet.
- `scripts/validate-plugin.mjs:15` repeats `'>=22.19.0'`; `.github/workflows/ci.yml:8` holds `node: ['22.19.0', '24']`.

## Goals / Non-Goals

**Goals:**
- One source per version: each host version and the Node floor is written once in code or config, and a check fails when a copy that cannot import it (a `package.json` pin, `engines.node`) disagrees.
- `docs/verification.md` reads procedure first, then dated records, with each host's procedure in the same place.

**Non-Goals:**
- An upper Pi bound, or a range for OpenCode. OpenCode's exact pin rests on known 2.2.5 behaviour (`docs/known-issues.md`).
- Changing the Pi Durable or Chord pins.
- Rewording any dated record, or changing loop, bb or OpenCode behaviour.
- A validator that bans phrases such as "both hosts": deliberate scope statements (`openspec/specs/pi-integration/spec.md:18`) would trip it.

## Decisions

### `PI_VERSION` becomes the minimum, equal to the Pi SDK dev pin

The floor is 1.5.2, the SDK version that the suite type-checks and tests against. The live runs on Pi 1.5.0 and 1.5.1 used older plugin code, so they do not support a lower floor. `tests/package.test.ts` asserts the `pi-coding-agent` dev pin equals `PI_VERSION`, so raising one without the other fails the suite.

*Alternative:* floor 1.5.0 from the recorded live runs. Rejected: no current code was tested there.

### One guard in `src/util.ts`

`requirePi(found)` matches `^(\d+)\.(\d+)\.(\d+)` on `found` and `PI_VERSION`, compares the three numbers in order, and throws "Pi loop requires Pi ${PI_VERSION} or later; found ${found}" when `found` is older. A version that does not match counts as older and is refused, as is Pi's `"0.0.0"` fallback. Pre-release suffixes are ignored: `1.6.0-beta.1` passes. `src/pi-service.ts` calls `requirePi(VERSION)` at the top of start and resume, and `tests/live/pi.ts` calls it on the `pi --version` output instead of `assert.equal`, still recording the found version. The message is written once, and the unit test checks it.

*Alternatives:* `semver` as a direct dependency, for three lines of comparison (rejected); importing the transitive copy (rejected, as it is not ours to rely on).

### `peerDependencies` stay `"*"`

A `>=1.5.2` range would be a second copy of the floor, and the start/resume check is what enforces it whether or not Pi's installer reads peer ranges.

### Tests import the version constants

Fakes and expectations use `OPENCODE_VERSION` and `PI_VERSION`. Tests that need a mismatching version derive it, for example `'0.0.0'` or a different literal clearly marked as "other". `tests/live/opencode.ts` imports `OPENCODE_VERSION` from `src/util.ts`, as `tests/live/pi.ts` already imports from `src/`. The constant is not part of the snapshot under test, so this does not weaken the snapshot check. `tests/package.test.ts` also asserts that `@opencode/client` and `@opencode/plugin` equal `OPENCODE_VERSION`.

### The package validator reads the Node floor from CI

`scripts/validate-plugin.mjs` reads `.github/workflows/ci.yml`, takes the first entry of the `node:` matrix, and asserts `pkg.engines.node === '>=' + floor`. This replaces the literal, so the CI drift `b066680` fixed fails the check. It is a regex over one known line, with a `shortcut:` comment noting that a reshaped matrix needs the pattern updated.

### Host lists only where they say something

`README.md:290` says the known-issues page lists the upstream bugs that shape the plugin, and `AGENTS.md:36` says "Upstream bugs …"; `docs/known-issues.md` keeps the enumeration in its intro and headings. The AGENTS.md host checklist drops "the known-issues line above". The version checklists become: OpenCode, change `OPENCODE_VERSION` and the `@opencode/*` pins (the package test enforces equality); Pi, raise `PI_VERSION` and the SDK dev pin together; then grep the docs for the old version.

### `docs/verification.md` layout

```
# Verification
## Automated checks          (suite, Pi deterministic paragraph, coverage bullets)
## Live fixture and independent checks
### Attempt lifecycle and evidence
## Manual checks
### bb live commands        <- moved above OpenCode, text unchanged
### OpenCode live commands
### Pi live commands        <- moved from "## Opt-in Pi checks", text unchanged
### Workflow validation (bb CLI)
### bb
### OpenCode 2.2.5
## Recorded results          + one line: paths and counts are as of each date
### ... every record, newest first; the 2026-11-09 Pi record drops from ## to ###
```

The live-command sections follow the host order used by the procedures below them (bb, then OpenCode) and the README. The coverage bullets now under `## Opt-in Pi checks` return under `## Automated checks`. Record bodies move verbatim. Lines over 80 columns in the moved procedure text are rewrapped, with the words unchanged. AGENTS.md's reference to "Opt-in Pi checks" becomes "Pi live commands".

### README order

The host sections become bb, OpenCode, Pi; the intro and Development section stay where they are. The Development paragraph names `npm run test:live:{bb,opencode,pi} -- --help` together and links known issues without listing hosts.

## Risks / Trade-offs

- [A future Pi major release changes the extension API and loads, then fails inside a command.] → The failure surfaces as a command error. Add a ceiling, or raise the floor, when that is observed.
- [On any Pi newer than 1.5.2, the host's `pi-ai`, which the plugin's own imports resolve to, can differ from the `pi-ai` 1.5.2 that Durable depends on, so a minor or patch Pi release could break the models the plugin hands to Durable.] → Accepted with the floor: no such break is observed, and the suite cannot reproduce one. A model or worker error on a newer Pi is the trigger to raise the Durable and Chord pins to that Pi's version.
- [A pre-release of the floor itself, such as `1.5.2-rc.1`, passes the check.] → Accepted; Pi pre-releases are not a supported install.
- [Reordering README and `docs/verification.md` makes a large diff with little textual change.] → Moves are verbatim, so reviewers can compare with `git diff --color-moved`.
