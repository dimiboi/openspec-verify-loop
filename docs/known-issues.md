# Known upstream issues

Bugs and behaviours in bb, OpenCode and OpenSpec that shape how this plugin is
built or tested. Each entry says what happens, where it is tracked, and what the
plugin does about it. Remove an entry when the upstream fix ships and the
workaround is gone.

## bb

### Thread identity is not authenticated

- **What happens:** the `bb` CLI takes the calling thread from `BB_THREAD_ID`,
  and the local API (`/api/v1`, `/ws`) requires no credential. Any local process
  can act as any thread, with or without the CLI.
- **Observed:** in the OpenCode/Flint verify loop on `unified-verify-loop-mvp`
  (run `run_1a19efeef75e162d550cf354239be3cd28d217a87e3`, fixer session
  `ses_1a19f2b82b5e3df73ad7b66408dadff83805a1f5250`), fixer 1 had nothing to
  fix. It set `BB_PROJECT_ID=proj_hxz5mmsjzp BB_THREAD_ID=thr_22h3acdk8c` (an
  earlier hidden workflow worker) and ran `bb workflows validate` and
  `bb workflows list` as that thread. bb accepted both. The commands were
  read-only and nothing was damaged.
- **Tracked:** get-bb/bb#3708 (open) proposes a per-install secret. That would
  not stop this case: a worker runs as the same user and can read the secret.
  Stopping an agent from posing as another thread needs per-thread credentials
  that the server checks against the claimed thread.
- **Effect on the plugin:** on bb the server entry hides the
  `openspec-verify-loop` skill from Workflows workers, and the worker prompts
  forbid starting or stopping loops or workflows. Neither stops a worker in
  `full` mode from typing `bb workflows run` in its shell, even as another
  thread. On OpenCode the loop tool is denied to workers by session
  permissions.
- **Mitigation:** the hidden skill and the prompt rule. Impersonation stays
  open; see C41 in [future improvements](future-improvements.md).

### Workflows rejects models with an empty reasoning list

- **What happens:** Workflows refuses a worker whose model's catalogue entry has
  `reasoningDiscovery: "known"` and no reasoning levels, both for an explicit
  `reasoningLevel` and for a worker inheriting the thread's level. Reproduced
  for the explicit case: `Unsupported reasoning level for literal workflow
  selection acp-opencode/lmstudio/recursivesi/flint/medium`.
- **Tracked:** get-bb/bb#6792, fixed by get-bb/bb#6793 (merged 2026-11-03,
  after the latest release, bb 0.48.1).
- **Why the list is empty:** see the next entry.
- **Workaround:** until a bb release ships the fix, start Flint loops from a
  custom ACP profile whose `nativeReasoning` fills in `medium` (README, "ACP
  providers and local Flint").

### ACP model discovery stores another model's reasoning options

- **What happens:** bb discovers each model's reasoning options by switching the
  ACP session through every model. It records each reply against the model it
  asked for without checking the reply's `currentValue`. When OpenCode answers a
  switch late (next section), local Flint is recorded with the options of the
  model probed before it, `bonsai-27b`, which has none. In probes in catalogue
  order this happened in 9 of 12 runs. Each environment keeps its last result,
  so Flint's list flips between `[]` and `medium, default`.
- **Tracked:** get-bb/bb#6871, fixed by get-bb/bb#6874 (merged 2026-11-03,
  after bb 0.48.1). The agent-side cause, anomalyco/opencode#60316, is open.
- **Workaround:** the same custom ACP profile as above, until a bb release
  ships the fix.

### Workflow status and history are scoped to the run's project

`bb workflows status` and `bb workflows history` report `Unknown workflow run`
when called from a thread in another project. The bb skill reads status from
the thread that started the run, which is always in the run's project.

### Git install replaces a committed `dist/`

bb's documentation says a Git install builds the declared server entry and
replaces any committed `dist/`, which would drop the OpenCode bundle
(`dist/index.js`) from a bb install. bb never loads that bundle, so the plugin
keeps it in `dist/`. Not yet observed: the manual runs installed bb from a local
path. Check it when the branch is pushed. Related: `bb plugin install git:` does
not accept a `file://` URL (it is rewritten to `https://file:///…`), so a local
repository has to be installed with `path:`.

## OpenCode

### Plugin unload discards controls after cleanup rejects

- **What happens:** OpenCode 2.2.5 removes a project plugin after its async
  cleanup callback rejects. The callback's rejection does not preserve the
  plugin instance or its commands. An immediate plugin-list read can still
  report active before removal completes.
- **Observed:** 2026-11-04, existing host PID 84809, isolated
  `verify-loop-native-unload-uJoSP5/app` fixture. Removing the project's plugin
  configuration while worker
  `ses_1a1a7a4ab7a14babdca2dfd4fb198632e82d03a395b` was active invoked cleanup
  for run `run_1a1a7a4ab7aa3baaac4f1b4491bb9f2157e4c6e2966`. A test-only adapter
  injected an interruption error; the real plugin cleanup rejected with that
  worker's identity. The worker remained busy, the plugin then disappeared,
  and `/opsx-verify-loop-stop` returned CommandNotFoundError. The test directly
  interrupted and waited for the native worker afterward. No service was
  started, replaced or stopped.
- **Effect on the plugin:** a failed stop retains its worker and reservation
  while the plugin remains loaded, but a host-forced unload discards that
  instance's controls. Another loaded instance shares the checkout reservation
  and can retry stop; a full module reload loses in-memory ownership. The plugin
  cannot prevent that host behavior by rejecting its cleanup callback. Normal unload, with confirmed interruption,
  passed in the same fixture.
- **Workaround:** if unload fails, use OpenCode's native session controls to
  interrupt the named worker and confirm it is inactive before starting another
  loop. Reinstalling/reloading the plugin does not prove that worker stopped.
  This change adds no cross-reload lock or service-management workaround.
- **Tracked:** not reported upstream.

### A resubmitted input ID restarts a finished session

- **What happens:** in OpenCode 2.2.5, submitting a prompt again with an input ID
  the session already has can restart its execution, even after it finished.
- **Effect on the plugin:** a worker prompt is submitted at most once. An
  uncertain submission is reconciled by its input ID, and the run fails if the
  prompt is not found (`src/opencode.ts`, AGENTS.md).

### Late reply to a model switch

`opencode acp` often answers `session/set_config_option` for a model switch
before applying it, so the reply describes the previously selected model. This
is the agent-side cause of the bb discovery entry above. Tracked in
anomalyco/opencode#60316.

### bb plugin skills are not OpenCode commands

On ACP providers, typing `/openspec-verify-loop` sends the text to the agent but
does not load the skill: OpenCode advertises only its own commands, and bb's
plugin skills live outside OpenCode's skill folders. Pick the skill from bb's
`/` menu or name it in the prompt (README, "ACP providers and local Flint").

### Testing notes

- A newly loaded location's first catalogue read can be empty. In the
  2026-11-04 hardening checks, a fixture configured before its first load
  advertised its local package plugin and skill after subsequent reads,
  without a global reload. Supply a local plugin package directory with its
  manifest, and wait for the advertised plugin/skill before starting a check.
  `opencode reload` rebuilds every loaded location; do not use it just to refresh
  an isolated manual fixture.
- `opencode run "/opsx-verify-loop …"` sends the slash text as a prompt, not as a
  command. Native commands can be sent headlessly with the client's
  `session.command({sessionID, name, text})`.

## OpenSpec

### The verify skill asks the user to pick a change

When several changes are active and none is named, the `openspec-verify-change`
skill tells the agent to list them and ask the user to choose. Hidden workers
cannot ask, so the verifier prompt says to end with `VERDICT: BLOCKED` and list
the active changes instead. Passing a change name avoids the question.

### The verify skill marks a missing optional design as Not verified

- **What happens:** the `openspec-verify-change` skill says design documents
  are optional and that it must not "require or invent optional or
  intentionally omitted artifacts to obtain a clean report", because
  `Not verified` is a limit of the report
  (`.agents/skills/openspec-verify-change/SKILL.md:73`). Its Design Adherence
  step still marks the check Not verified when `design.md` is absent (`:155`),
  and it prints "All checks passed" only when no check was skipped.
  `openspec status` reports the design artifact as `ready`, not skipped, so the
  skill cannot tell a deliberate omission from a forgotten file.
- **Observed:** in live runs of a sibling verify-fix loop whose fixer prompt,
  like this plugin's before the `unverified` status, asked fixers to resolve
  Not verified checks. On a sandbox change that rightly had no `design.md`,
  fixers on Claude, local Flint and Codex each wrote a `design.md` describing the code they had just
  fixed, and the next verification passed `clean` against it.
- **Tracked:** not reported upstream.
- **Workaround:** the verifier prompt says a change without `design.md` has
  omitted an optional document, so Design Adherence is Not applicable, the
  skill's own label for a check that does not apply. Such a change can end
  `clean`; the cost is that a change which needed a design but has none is no
  longer flagged. If a verifier still marks the check Not verified, the run
  ends `unverified` without a fixer, as for any other check that could not
  run. The fixer prompt says a Not verified check is not an issue and forbids
  creating optional artifacts to satisfy one. Remove this entry and the prompt
  rule when the skill reports a missing optional design as Not applicable.
