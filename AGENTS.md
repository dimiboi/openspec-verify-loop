# Working in this repository

- Use Node.js >=22.19 and `npm ci`. Run `npm run check` for code changes: types, build, deterministic tests, and package validation. Edits to docs, specs or `.github/workflows/ci.yml` do not need the suite, except a change to its `node:` matrix, which needs `node scripts/validate-plugin.mjs`; run `openspec validate --specs` after editing a spec.
- If `npm ls` reports missing packages, run `npm ci`; a read-only task reports it instead of working around it.
- Run `npm ci` and `npm run check` with the same npm cache (the same `npm_config_cache`, or both on the default): the offline snapshot test installs production dependencies from that cache, and an `ENOTCACHED` failure in `tests/live-opencode.test.ts` means the caches differ.
- Edit `src/`; `npm run bundle` generates the committed `dist/index.js`, `dist/pi.js` and `dist/pi-supervisor.js`. Keep host SDK/runtime dependencies external to the bundle.
- Resolve packaged resources from `import.meta.url` and consuming project paths from the invoking session's location. The plugin must never start, replace, or stop an OpenCode service.
- README and `docs/` are hard-wrapped at about 80 columns: read the exact lines before editing, since quoted text in reports is often rewrapped. Local tooling is macOS/BSD (no `timeout`, no `cat -A`).

## Where things live

- Loop: `skills/openspec-verify-loop/verify-loop.js`; `src/loop.ts` runs it in a bb-like sandbox for OpenCode and Pi.
- bb: `bb/server.ts` (server entry) and `skills/openspec-verify-loop/SKILL.md`.
- OpenCode: `src/plugin.ts` (entry, version check), `src/service.ts` and `src/manager.ts` (runs), `src/runner.ts` and `src/opencode.ts` (workers), `src/tools.ts` and `src/commands.ts` (tool and slash commands), `src/workers.ts` (worker permissions), `opencode/SKILL.md`.
- Pi: `src/pi.ts` (entry, commands), `src/pi-service.ts` (version check, start, resume, stop), `src/pi-runtime.ts` (Durable store and reports, including the read-only retry), `src/pi-ownership.ts` (checkout lock), `src/pi-process.ts` and `src/pi-supervisor.ts` (worker processes), `src/pi-context.ts` (provider and auth), `src/pi-files.ts` (state files).
- Shared: `src/util.ts` (host version constants, errors) and `src/config.ts` (options).
- Build: `scripts/bundle.mjs` builds `dist/`; `scripts/validate-plugin.mjs` validates the package.
- Tests: `tests/*.test.ts` are deterministic; `tests/live/*` are the opt-in drivers behind `npm run test:live:{bb,opencode,pi}`.
- Docs: `docs/verification.md` (procedure, then dated records from `## Recorded results` on), `docs/pi-*-<date>.md` (dated run notes), `docs/known-issues.md`, `docs/future-improvements.md`, and the specs in `openspec/specs/`. Dated records describe the past: add a new record, never rewrite an old one to match the current state.

## Loop invariants

- `skills/openspec-verify-loop/verify-loop.js` is the only place that decides rounds, verdicts and prompts. All hosts run it unchanged; it may use only `agent`, `phase`, `log`, `args` and `budget`.
- Workers run sequentially, with a fresh session for each verification and fix. The last round is always a verification.
- Clean requires a verifier reply ending `VERDICT: CLEAN` whose report shows no nonzero count of critical issues, warnings or suggestions and no `Not verified` check. When the report has a Final Assessment section, only that section is read, since earlier sections may quote such marks.
- A report whose only gaps are `Not verified` checks ends `unverified`, decided from both its `VERDICT: UNVERIFIED` line and the report text. A change without `design.md` passes Design Adherence: verifiers mark it Not applicable, not Not verified. Fixers never create optional artifacts to clear a check.
- Never resubmit a worker prompt. OpenCode 2.2.5 can restart execution for duplicate input IDs: reconcile an uncertain submission by its input ID, and fail the run if it is not found.
- Plugin cleanup must interrupt the active worker before unloading completes.
- On Pi, report opens the Durable JSONL store read-only (`{readOnly: true}` on both the storage open and the Harness), afresh for each report, and never writes or needs ownership. Every writable open (start, resume, stop, cleanup) happens under exclusive checkout ownership: a writable JSONL open repairs files on recovery.
- On OpenCode, workers cannot start or stop loops or delegate further workers, and reporting turns cannot use tools. On bb, the server entry hides the skill from Workflows workers and the prompts forbid loops, but `bb workflows run` stays reachable from a worker's shell; see [docs/known-issues.md](docs/known-issues.md).

The automated suite uses fake host/model adapters; it must not call models or start OpenCode sessions. Some Pi checks run local subprocesses against the installed Durable package, still with no model request. Real-host testing is manual; see [docs/verification.md](docs/verification.md).

Possible additions wait for an observed trigger; they are listed in [docs/future-improvements.md](docs/future-improvements.md). Do not build one before its trigger is seen.

Upstream bugs that shape the plugin, and their workarounds, are listed in [docs/known-issues.md](docs/known-issues.md). Check it before changing a workaround, and update it when an upstream fix ships.

## Changing hosts or host versions

- Host set: update the `package.json` description, the README intro, the `## Purpose` of each `openspec/specs/*/spec.md` and the `docs/known-issues.md` intro. Then run `git grep -nE 'both hosts|two hosts|bb (and|or) OpenCode' -- . ':!openspec/changes'` and judge each hit; some are deliberate scope statements, such as `openspec/specs/pi-integration/spec.md:18`.
- Pi version: `PI_VERSION` in `src/util.ts` is the minimum Pi that start and resume accept. Raise it with the `@earendil-works/pi-coding-agent` dev pin in `package.json` (`tests/package.test.ts` checks they agree) and the `requirePi` cases in `tests/pi-service.test.ts`, then run `npm install` for the lockfile. Then `git grep -n '<old version>' -- . ':!openspec/changes'` finds the rest: README `## Pi`, "Pi live commands" in `docs/verification.md`, and comments; leave dated records alone. The Pi Durable and Chord pins are separate: raise them only when a newer Pi is observed to break with them, then re-run the **Check:** of each Pi Durable entry in `docs/known-issues.md`. Finish with `npm run check`, which rebuilds `dist/`.
- OpenCode version: change `OPENCODE_VERSION` in `src/util.ts` and the `@opencode/*` pins in `package.json` (`tests/package.test.ts` checks they agree), then run `npm install`. Then `git grep -n '<old version>' -- . ':!openspec/changes'` finds the rest: README, the OpenCode procedure in `docs/verification.md`, comments and the invariants above; leave dated records alone. Re-run any OpenCode **Check:**, then `npm run check`.
- Node floor: change `engines.node` and the lowest `node:` matrix entry in `.github/workflows/ci.yml` together (`scripts/validate-plugin.mjs` checks they agree). Then `git grep -n '<old floor>' -- . ':!openspec/changes' ':!package-lock.json'` finds the rest, such as the Node versions stated here and in README; leave dated records alone.
