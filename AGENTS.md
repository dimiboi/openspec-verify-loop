# Working in this repository

- Use Node.js >=22.18 and `npm ci`. Run `npm run check` for code changes: types, build, deterministic tests, and package validation. Documentation-only edits do not need the suite.
- Edit `src/`; `npm run build` generates the committed `dist/index.js`. Keep host SDK/runtime dependencies external to the bundle.
- Resolve packaged resources from `import.meta.url` and consuming project paths from the invoking session's location. The plugin must never start, replace, or stop an OpenCode service.

## Loop invariants

- Workers run sequentially, with a fresh session for each verification and fix.
- Clean requires a fresh complete verifier report, zero findings at every severity, evidenced prior resolutions, and passing applicable checks against the same workspace revision.
- Persist dispatch identities before mutations. OpenCode 2.2.5 can restart execution for duplicate input IDs: reconcile saved inputs instead of replaying uncertain submissions.
- Keep state outside the checkout/package and retain checkout reservations until worker termination is confirmed. Plugin cleanup must drain owned tasks before relinquishing execution ownership.
- Worker sessions cannot invoke loop management or delegate further workers. Reporting turns cannot use tools.

The automated suite uses fake host/model adapters; it must not call models or start OpenCode sessions. Real-host testing is manual; see [docs/verification.md](docs/verification.md).
