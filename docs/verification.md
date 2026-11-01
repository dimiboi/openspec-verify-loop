# Verification record

Validated on November 1, 2026, on macOS arm64 with OpenCode 2.2.5,
`@opencode/client` 2.2.5, OpenSpec 1.16.0, Node 26.13.0, and Node 22.18.0.

## Automated checks

- `npm run check` passed with **36 tests**, covering type checking, generation of
  the standalone runtime, controller/report/recovery/installation tests, and skill
  resource validation. Targeted checks were repeated after the final context and
  evidence-persistence refinements.
- The minimum Node 22.18 runtime passed the initial 34-case full suite and the two
  subsequently added commit-boundary and crash-after-clean regressions.
- Copy and symlink installations ran independently of source dependencies,
  survived relocation, and handled paths containing spaces.
- The actual Skills CLI discovered and installed this repository's skill into an
  isolated project's `.agents/skills`; the installed setup command succeeded.
- The runtime dependency audit reported zero vulnerabilities.

The automated scenarios include all three severities, unresolved prior findings,
missing evidence, contradictory or malformed reports, independent failing checks,
new regressions after a fix, limits, stalled cycles, source/HEAD mutation,
permission waits, unknown/lost admission, competing controllers, cancellation,
requirement/procedure drift, and interrupted finalization. Check commands are
tested for direct argument execution and process-tree cleanup on timeout.

## Live OpenCode exercise

The installed skill was copied into a separate Git project containing a deliberate
greeting defect and a failing Node test. The project had a baseline commit so the
implementation diff was identifiable. OpenCode discovered `/verify-loop` and the
two worker profiles through its real catalogs.

Run: `run_1a1986654a0b013cfb54f444781b2d2030e0de1b745`.
Model: `openrouter/deepseek/deepseek-v4.1-flash-1017`.

| Assignment | Session | Result |
| --- | --- | --- |
| Verifier, round 1 | `ses_1a1986668856fb0afa32ec748379de2ce4abfcbb101` | 1 critical, 2 warnings, 2 suggestions; 7 failed checks |
| Fresh fixer | `ses_1a1986eb7baa83de1ebb5b045a5bc714ec5399e66a0` | Addressed all 12 finding/check items; changed only the greeting and its tests |
| Fresh verifier, round 2 | `ses_1a1986f3cb824800fde1d214a0fa510a6fa54f16b62` | Zero findings, 9 verified checks, 12 evidenced prior resolutions |

The final controller outcome was **clean**. An independent post-run invocation
repeated strict OpenSpec validation and the Ada/Grace tests successfully and
confirmed the workspace hash matched the accepted verifier's revision:

```text
7c68eb7e3b13ea4c8bc48bc76fbbb3a4ac673e1e94548b3c66f569cf3c4039fc
```

The test harness simulated a user allowing a narrow set of fixture inspection and
runtime-check requests, then explicitly resumed the saved run. The controller
itself did not grant permissions. Session and input identities were preserved
through these waits; each new assignment used a new session.

Local `lmstudio/recursivesi/flint` additionally passed the API probe: real profile
selection, OpenSpec skill loading, completed-response collection, and reconciliation
without duplicate execution. Its full-cycle trial was stopped because inference
was slow. The free hosted Flint endpoint returned a provider quota error, which
was recorded as an unsuccessful outcome rather than a clean report.

## Operational findings and limits

- OpenCode 2.2.5 prompt submission is asynchronous. Acknowledgement is not a
  completed report. Duplicate input IDs can restart execution after delivery;
  recovery reads persisted inbox/messages and does not blindly re-prompt.
- If admission is uncertain and no input can be observed, automatic replay and
  cancellation cannot be proven safe. The run retains its reservation for
  operator reconciliation. Missing or corrupt lock-owner metadata also requires
  inspection rather than automatic lock deletion.
- This release supports OpenSpec roots at the selected Git checkout root. Stores,
  multiple implementation repositories, and nested subproject roots are outside
  the first release's scope. Approved requirements/design changes invalidate the
  pinned run; the fixer cannot invent those decisions to force a clean result.
- The live exercise covered the bundled CLI and native command discovery. It did
  not automate the OpenCode TUI's background-shell notification UI. Closing and
  reopening the initiating chat is handled through saved status and explicit
  resume, without a guarantee of automatic chat recovery.
- The GitHub Actions workflow is included for Linux/Node 22.18 and 24; hosted CI
  has not been launched from this checkout. Windows-specific process-tree
  termination has not been exercised.

The live JSON/Markdown reports and a separate independent-check result were
preserved in this work session's verification-evidence archive. The ignored
`.live/latest-live.json` also points to the original fixture and run storage.

Use `npm run check` for routine verification and the opt-in `test:live` script for
a new model-backed exercise. See [README.md](../README.md) for installation,
configuration, permissions, and recovery commands.
