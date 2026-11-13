# Proposal

## Why

Pi and OpenCode independently validate the same change name, store ID and
verification limit. Sharing these definitions removes a small source of drift
without combining host runtimes or changing the loop's behavior.

## What Changes

- Extract host-independent start-argument field schemas and their inferred
  type, using the existing Zod dependency.
- Reuse the definitions in OpenCode's tool/action schemas and plugin options,
  and in Pi's start-command validation.
- Preserve host-specific parsing, error reporting, default application and
  validation before dispatch; retain the workflow's independent round check.
- Add focused compatibility coverage for the existing accepted and rejected
  inputs, including omitted values and unsafe integer limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a pure refactor of the existing `opencode-integration` and
`pi-integration` behavior. The change declares `skip_specs: true`; existing
specifications remain the acceptance contract.

## Impact

Expected source changes are a small `src/arguments.ts` module and its consumers
in `src/service.ts`, `src/config.ts` and `src/pi-context.ts`. Focused tests belong
with argument validation and the existing OpenCode/Pi entry tests. The normal
build regenerates committed bundles during implementation.

No dependency, host-version, command-syntax, saved-record or workflow-script
changes are needed. bb continues to run the unchanged shared script. Package
snapshot utilities, terminal-result types and lifecycle unification are outside
this change.
