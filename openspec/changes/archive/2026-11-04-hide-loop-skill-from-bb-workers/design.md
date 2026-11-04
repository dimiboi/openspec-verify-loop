# Design

## Context

See proposal.md for the motivation. These facts come from bb 0.48.1's source,
read from the source maps in `bb.app`, and from the staged catalogs on disk:

- bb picks each thread's skills when the thread starts or submits a turn, by
  calling every plugin's `bb.agents.configure` callback with that thread's
  context, including `origin.pluginId`. A plugin with a callback exposes only
  the skills it returns. A plugin without one exposes all its skills.
- The host daemon writes each skill set to a folder named by a hash of its
  contents, and keys provider processes by that hash too. A worker with a
  smaller skill set gets its own provider process, even in the parent's
  checkout. The "busy environment keeps its staged catalog" note in bb's docs
  is about when the shared runtime restarts, not about which skills a thread
  sees.
- Workflows does this for its own skill: for threads it started
  (`origin.pluginId === "workflows"`) it returns `skills: []`. Three staged
  catalogs on this machine lack `workflows` and still list
  `openspec-verify-loop`.
- bb checks the callback's return value strictly. It must be an object with
  only `tools`, `skills` and optional `instructions`. `tools` and `skills` must
  be arrays, and every id must be one of this plugin's own. If any check fails,
  or the callback throws, bb fails closed for this plugin: **no** thread gets
  the skill, the user's included.

## Goals / Non-Goals

**Goals:**

- Workflows workers never see `openspec-verify-loop` in their skill list.
- Every other thread sees it exactly as today.

**Non-Goals:**

- Blocking `bb workflows run` from a worker's shell; only the prompt rule
  addresses it.
- Hiding other plugins' loop skills, such as bb-openspec's `verify-fix-loop`.
  Its launcher already refuses to run inside a workflow worker.
- Worker impersonation of other threads (C41).

## Decisions

### Hide by origin, for every Workflows worker

The callback returns `{tools: [], skills: []}` when `origin.pluginId` is
`"workflows"`, and `{tools: [], skills: ["openspec-verify-loop"]}` otherwise.
It checks the origin, not this loop's runs, because no workflow worker has a
reason to start this loop. A worker of an unrelated workflow is as wrong a
place for it as one of ours. It is the same test Workflows uses for its own
skill, and the same signal bb-openspec's launcher checks.

Alternatives: match only this loop's workers through plugin metadata. Rejected
because Workflows does not let a script seed worker metadata, and the wider
rule is simpler and correct. Leave the skill visible and rely on the prompt
alone. Rejected because the observed path is the skill itself, and bb offers
enforcement for it.

### Always return `tools: []`

`tools` is required even though the plugin registers no tools. A missing field
throws, and bb then hides the skill from every thread. The test asserts the
exact shape of both return values.

### No bb SDK dependency

`bb/server.ts` declares the small slice of the plugin API it uses as a local
type: `agents.configure` and the context's `origin.pluginId`. bb loads the
entry as TypeScript and passes the real API. Adding `@get-bb/plugin-sdk` for
one callback would add a dependency the package otherwise does not need, and
its testing helpers are not needed for a two-branch function. The test calls
the default export with a fake `bb` that captures the callback.

Shortcut: the local type can drift from the SDK. bb validates the return value
at runtime and fails closed, so drift shows up as a missing skill rather than
as silent misbehaviour; the manual check below catches it.

### Skill id from the skill's frontmatter

The id must match the `name` in `skills/openspec-verify-loop/SKILL.md`; an
unknown id fails closed. The test reads that frontmatter and compares, so a
rename fails the suite instead of hiding the skill everywhere.

### One shared prompt rule

The rule goes into the shared `rules` list in `verify-loop.js`, so verifiers
and fixers on both hosts carry it. The wording follows bb-openspec's fixer
line, which stopped the nested loop in its later live runs: do the task
yourself, use no verify-loop skill, start no loops or workflows, delegate to no
other agents. On OpenCode it repeats what permissions already enforce, and
costs one line.

## Risks / Trade-offs

- [A worker still reaches `bb workflows run` through the shell, or reads the
  parent's staged skill file from disk] → The prompt rule forbids it. Full
  enforcement needs per-thread credentials in bb (see known issues).
- [A future bb changes the callback contract or the Workflows plugin id] → bb
  fails closed, so the skill disappears everywhere instead of leaking. The
  manual check after install shows it.
- [A malformed return value hides the skill from the user's own threads] → The
  test pins both return values and the skill id.

## Migration Plan

None. Reinstalling or reloading the plugin applies the callback to new
threads and new turns. Rolling back restores today's behaviour.
