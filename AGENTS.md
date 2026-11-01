# Working in this repository

- Use Node.js >=22.18 and `npm ci`. Run `npm run check` for code changes; it checks types, builds, runs tests, and validates skill resources. Documentation-only edits do not need the suite.
- Edit runtime code in `src/`. `npm run build` generates the skill's `scripts/controller.mjs`, `LICENSE`, and `references/third-party-licenses.txt`; include regenerated outputs rather than editing them directly.
- Keep `skills/openspec-verify-loop/` self-contained: consumers have no npm dependencies. Resolve bundled resources from the installation directory and project files from the consuming checkout.

## Loop invariants

- Run workers sequentially, with a fresh session for each verification and fix.
- Clean requires a fresh complete verifier report, zero findings at every severity, evidenced prior resolutions, and passing applicable checks against the same workspace revision.
- Persist dispatch identities before network mutations. OpenCode 2.2.5 can restart execution for a duplicate input ID: reconcile existing inputs instead of replaying uncertain submissions.
- Keep state outside the checkout and installed skill. Retain checkout reservations until worker termination is confirmed.

## Integration checks

Use deterministic tests for loop behavior. For OpenCode integration changes, use isolated fixtures with `VERIFY_LOOP_LIVE_MODEL=provider/model npm run test:live`; this calls the configured model. See [README.md](README.md) for usage and [docs/verification.md](docs/verification.md) for API findings and tested limits.
