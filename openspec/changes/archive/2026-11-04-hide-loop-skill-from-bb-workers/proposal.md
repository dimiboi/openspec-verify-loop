# Proposal

## Why

bb workflow workers can see the `openspec-verify-loop` skill and start a loop
of their own. bb stores each thread's skill set in
`~/.bb/runtime/global-skills/<hash>/catalog.json`. The three catalogs there
without bb's `workflows` skill belong to Workflows' own workers, and all three
list `openspec-verify-loop`. That is the path C13's trigger describes, and the
trigger has been seen: in the sibling bb-openspec plugin's live run on
2026-11-03, a Flint fixer asked to fix a report loaded an installed loop skill
and started a nested loop. On OpenCode, worker sessions are already denied the
loop tool. On bb, nothing stops a worker; the prompts do not even forbid it.

## What Changes

- The bb server entry hides the `openspec-verify-loop` skill from Workflows
  worker threads, the same way Workflows hides its own skill. Every other
  thread keeps it.
- The shared worker rules tell every worker not to start loops or workflows
  and not to delegate to other agents. This covers what hiding the skill cannot
  reach: `bb workflows run` typed in the shell, or another loop skill. It
  instructs; it does not enforce.
- On OpenCode, nothing changes beyond the new rule line in the shared prompts.
  The permission deny stays.

Out of scope: stopping a worker from posing as another thread (C41), and
detecting other loop plugins' skills.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bb-integration`: the "bb plugin package" requirement lets the server entry
  register only an agent configuration that hides the skill from workflow
  workers.
- `verification-loop`: the "Worker rules" requirement adds the
  no-loop/no-delegation rule to every worker prompt.

## Impact

- `bb/server.ts`: registers the agent configuration.
- `skills/openspec-verify-loop/verify-loop.js`: one shared rule line.
- `tests/`: a test for the bb server entry; the worker-rules assertions.
- `AGENTS.md`, `README.md`, `docs/known-issues.md`,
  `docs/future-improvements.md`, `docs/verification.md`: bb now enforces part
  of the rule; C13 leaves the list; a manual record.
- No new dependencies.
