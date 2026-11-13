# Tasks

## 1. Shared argument definitions

- [x] 1.1 Add `src/arguments.ts` with host-independent Zod field definitions,
  an optional strict start-argument shape and its inferred type. Add a compact
  validation test covering valid names/stores, empty and malformed strings,
  omitted fields, positive safe-integer limits, zero, negative and fractional
  numbers, NaN, Infinity, unsafe integers and numeric strings. Verify it with
  `npx tsx --test tests/arguments.test.ts`; confirm the module imports no host SDK
  and applies no defaults or coercion.

## 2. OpenCode consumers

- [x] 2.1 Compose OpenCode's run action and advertised tool fields from the
  shared definitions in `src/service.ts`, and reuse the round schema in
  `src/config.ts`. Extend `tests/plugin.test.ts` for strict unknown/action-only
  field rejection, the object-root tool schema, numeric-string rejection, and
  explicit/configured/default round-limit precedence. Verify with
  `npx tsx --test tests/plugin.test.ts`; retain validation before permission
  assertion and dispatch, and the existing slash-command grammar.

## 3. Pi consumer

- [x] 3.1 Replace Pi's duplicated field validation in `src/pi-context.ts` with
  the shared definitions and derive `PiArguments` from the common type while
  keeping its concrete round limit. Extend `tests/pi-context.test.ts` for
  omitted-key/default behavior, numeric conversion (including `1e2`), unsafe
  integer rejection, invalid-field messages and their existing validation
  order. Verify with
  `npx tsx --test tests/pi-context.test.ts tests/pi-entry.test.ts`;
  retain `parseArgs`, positional arity checks,
  `parseRunId` and validation before settings capture or runtime creation.

## 4. Integration and packaged output

- [x] 4.1 Run `npm run check` with the cache used for dependency installation
  and retain its regenerated bundles. Verify all deterministic, package and
  loading checks pass; inspect the diff to confirm no dependency updates,
  workflow-script changes, saved-record changes, lifecycle changes or edits to
  bb's launcher. If dependencies are missing, use `npm ci` with that same cache
  before the check. No live model run or documentation change is required for
  this behavior-preserving extraction.
