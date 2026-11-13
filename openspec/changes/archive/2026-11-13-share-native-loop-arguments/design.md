# Design

## Context

See `proposal.md` for motivation. `src/service.ts` owns OpenCode's Zod
definitions for change, store and round limit; `src/config.ts` independently
defines the same limit. `src/pi-context.ts` repeats the name patterns and uses
`Number.isSafeInteger` for limits after parsing command text.

The installed Zod version's `number().int().positive()` already enforces the
positive safe-integer range, matching Pi's current numeric validation. Pi also
performs string-to-number conversion; OpenCode tools require a numeric value.

OpenCode advertises a strict object as its tool schema and separately enforces
action-specific fields at execution. Its slash command accepts only an optional
change name. Pi uses `parseArgs` for an optional name, `--store` and
`--max-rounds`. These interfaces are intentionally different.

## Goals / Non-Goals

**Goals:**

- Keep each common field's validation in one module with no host SDK imports.
- Compose the existing host interfaces from that module without changing
  accepted inputs, output values, error reporting or validation timing.
- Infer argument types from the shared definitions rather than duplicating
  field types in Pi.

**Non-Goals:**

- Unifying command parsers, host action sets, worker execution or run state.
- Changing defaults, saved Pi records, recovery compatibility or bb's launcher.
- Changing test packaging, result types or procedure selection.

## Decisions

### Share field schemas and the optional start-argument shape

Add a small `src/arguments.ts` module using the existing Zod dependency. It
exports the change-name, store-ID and round-limit definitions, a strict
start-argument object with optional fields, and its inferred type. Keep the
current patterns and positive safe-integer rule. Include no coercion, defaults,
host settings, action discriminator or runtime initialization in this module.

OpenCode composes its run action from the start shape and reuses field schemas
in the advertised tool object. Plugin options reuse the round schema. Retain
strict unknown-key handling and rejection of start-only fields for stop/report.
Keep descriptions on the tool fields and preserve its object root for function
tool providers.

Pi retains its current tokenization, `parseArgs`, positional arity check and
`Number` conversion, then uses the shared definitions for field validation.
Preserve its existing messages for an invalid change, store or limit through
small local error translation; do not build a general error framework. Keep
the same validation order when several fields are invalid. Replace the
handwritten `PiArguments` field list with a type derived from the shared
arguments and a required numeric `maxRounds`, retaining its existing exported
name for current consumers.

An alternative was to reuse Pi's entire parser in OpenCode. That would broaden
OpenCode's slash-command grammar and move a CLI concern into the structured
tool boundary. Another was to put shared definitions in `pi-context.ts` or
`service.ts`; both import a host SDK, so that would introduce host dependencies
into unrelated consumers.

### Preserve omission and default application at each boundary

OpenCode leaves `maxRounds` optional: an explicit tool value overrides plugin
configuration, and an omitted value ultimately uses the script's default of
five. The shared schema must not insert a default before configuration is
consulted.

Pi continues returning a concrete round limit, defaulting to five, and omits
unsupplied change/store keys as before. Its runtime continues serializing those
missing names as null. Preserve Pi's existing `Number` conversion semantics,
including accepted numeric spellings such as `1e2`; do not add a decimal-only
parser during extraction. OpenCode continues rejecting numeric strings.

Moving defaulting into a common normalizer would change OpenCode precedence or
Pi's stored argument shape. Leaving those few operations at the host boundaries
keeps the extraction smaller and preserves compatibility.

### Keep the shared workflow untouched

`verify-loop.js` must remain self-contained for bb and cannot import the native
schemas. Its round check remains a separate execution boundary. No prompts,
round decisions or script bytes change, preserving Pi's saved loop hash.

Existing integration specs already cover the behavior. Mark this change
`skip_specs: true` rather than adding an implementation-detail requirement.

## Risks / Trade-offs

- Default injection could override OpenCode configuration -> keep the shared
  fields optional and test explicit/configured/fallback precedence.
- A schema extraction could broaden input acceptance or change Pi errors ->
  exercise host-facing cases for names, stores, numeric conversion, safe
  integer bounds, unknown fields and parser errors; retain existing messages.
- Shared imports could initialize the other host or weaken tool validation ->
  import only Zod in the new module, retain strict action schemas, and keep the
  existing inert-loading and object-root tests.
- A small refactor could grow into an adapter framework -> limit exports to
  argument definitions and types; retain all host lifecycle code.

## Migration Plan

No record or user-configuration migration is required. Wire the consumers,
run the deterministic check suite with the dependency-install cache, and let
the build regenerate committed bundles. Review the diff to confirm that the
workflow, lifecycle code and saved record formats did not change. Rollback is
the source extraction plus regenerated bundles; saved Pi runs remain readable.
