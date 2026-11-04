# Working in this repository

- Use Node.js >=22.18 and `npm ci`. Run `npm run check` for code changes: types, build, deterministic tests, and package validation. Documentation-only edits do not need the suite.
- Edit `src/`; `npm run bundle` generates the committed `dist/index.js`. Keep host SDK/runtime dependencies external to the bundle.
- Resolve packaged resources from `import.meta.url` and consuming project paths from the invoking session's location. The plugin must never start, replace, or stop an OpenCode service.

## Loop invariants

- `skills/openspec-verify-loop/verify-loop.js` is the only place that decides rounds, verdicts and prompts. Both hosts run it unchanged; it may use only `agent`, `phase`, `log`, `args` and `budget`.
- Workers run sequentially, with a fresh session for each verification and fix. The last round is always a verification.
- Clean requires a verifier reply ending `VERDICT: CLEAN` whose report shows no nonzero count of critical issues, warnings or suggestions and no `Not verified` check. When the report has a Final Assessment section, only that section is read, since earlier sections may quote such marks.
- A report whose only gaps are `Not verified` checks ends `unverified`, decided from both its `VERDICT: UNVERIFIED` line and the report text. A change without `design.md` passes Design Adherence: verifiers mark it Not applicable, not Not verified. Fixers never create optional artifacts to clear a check.
- Never resubmit a worker prompt. OpenCode 2.2.5 can restart execution for duplicate input IDs: reconcile an uncertain submission by its input ID, and fail the run if it is not found.
- Plugin cleanup must interrupt the active worker before unloading completes.
- On OpenCode, workers cannot start or stop loops or delegate further workers, and reporting turns cannot use tools. bb does not enforce this yet; see [docs/known-issues.md](docs/known-issues.md).

The automated suite uses fake host/model adapters; it must not call models or start OpenCode sessions. Real-host testing is manual; see [docs/verification.md](docs/verification.md).

Possible additions wait for an observed trigger; they are listed in [docs/future-improvements.md](docs/future-improvements.md). Do not build one before its trigger is seen.

Upstream bb, OpenCode and OpenSpec bugs that shape the plugin, and their workarounds, are listed in [docs/known-issues.md](docs/known-issues.md). Check it before changing a workaround, and update it when an upstream fix ships.
