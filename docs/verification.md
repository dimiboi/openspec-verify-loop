# Verification

## Automated checks

```sh
npm ci
npm run check
```

The suite checks types, builds `dist/index.js`, exercises the controller and plugin
against deterministic host/worker adapters, and validates the package export and
bundled skill. Fixtures use Git and OpenSpec locally; no OpenCode session, model
request, or native plugin installation is performed.

Coverage includes report completeness and contradictions, all severities, prior
resolutions, independent checks, source/HEAD changes, procedure/configuration
pins, fresh sessions, limits/stalls, unknown admission, cancellation, concurrent
ownership, same-process generation handover, and pending-worker cleanup.

Native interface tests cover command parsing, plugin registrations/disposal,
worker recursion rejection, tool-free reporting turns, host endpoint identity,
model references, options validation, and resource paths.
The Git-packaging regression uses npm's resolver against a local Git fixture. It
reproduces preparation failure with a `build` script, then verifies that the
package ships its prebuilt entrypoint and skill without starting child npm.

## Manual OpenCode checks

Real-host and model testing of this rewrite is left to the user. The automated
suite does not establish that host loading, notification rendering, or model
behavior works in OpenCode.

Use an isolated Git project with OpenSpec 1.16.0, the actual
`openspec-verify-change` skill, an active change, and OpenCode 2.2.5. For local
development, set its plugin package to this checkout's absolute path.
For GitHub installation, use a pushed ref that contains the plugin entrypoint.

1. Load the package and confirm `/verify-loop`, `/verify-loop-status`,
   `/verify-loop-resume`, `/verify-loop-stop`, and the bundled skill are available.
   No command or worker-profile files should be generated in the project.
2. Select the intended model and configure a required test command through plugin
   options. Introduce a small implementation defect with a failing test.
3. Run `/verify-loop <change>`. Check the run ID/report path, findings report,
   distinct fixer session, and distinct second verifier. A clean outcome must have
   zero findings, explicit prior resolutions, and independent passing checks.
4. Open a worker permission/question request. Confirm `awaiting_input`, answer in
   that worker session, and explicitly resume. The saved input must not be replayed.
5. Stop an active run, then check status and confirm termination before restarting.
   Reload/remove the plugin during a run and confirm that its owned work is
   interrupted or its checkout remains reserved if cancellation is unconfirmed.
6. Resume after reload/server restart. Check the same pending session/input IDs are
   reconciled; newly required assignments use fresh sessions.
7. Confirm start/status/final notices render, and their reporting turns cannot use
   tools. An ordinary subsequent user turn should retain its normal tools.

The supported target is a repo-local OpenSpec root at one Git checkout root.
Permissions are not a filesystem sandbox. Unknown admission and unconfirmed
termination remain reserved for explicit reconciliation; do not remove locks to
bypass them. Hosted CI and Windows process-tree behavior require their own runs.
