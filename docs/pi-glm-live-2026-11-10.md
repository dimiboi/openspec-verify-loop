# Pi with OpenRouter GLM: monitored dummy-repository run

## Setup

Run on 2026-11-10 from commit `784b45a`, with Node 26.13.0 and Pi and Pi
Durable 1.5.0. The model was `openrouter/z-ai/glm-5.3-flash` at Pi thinking
`high`. Credentials came from an `OPENROUTER_API_KEY` supplied through
`bb secret request` into a thread-local dotenv file and loaded only into the
driver's environment. No global Pi settings were changed.

```sh
set -a; . "$BB_THREAD_STORAGE/openrouter.env"; set +a
npm run test:live:pi -- --scenario fix-to-clean \
  --provider openrouter --model z-ai/glm-5.3-flash --reasoning-level high \
  --procedure "$PWD/.agents/skills/openspec-verify-change/SKILL.md" \
  --timeout 3600 --cleanup-timeout 60 --output "$BB_THREAD_STORAGE/glm-pi-live"
```

Preflight `npm ci` and `npm run check` passed with 170 deterministic tests,
both using the same thread-local `npm_config_cache` (see the npm cache note in
the [Flint run](pi-flint-live-2026-11-10.md)). Evidence:
`/Users/dmitry/.bb/thread-storage/thr_35sfqqd2pb/glm-pi-live/`. The refused
`medium` attempt is in `loop-live-pi-3xYDky/` and the passing run in
`loop-live-pi-PXoElk/`.

## Outcome

**Passed.** Run `run_1a1c2d28e423e5b185b256146f38af5d5d04db8eb55` ended
`clean` after 2 verifications. Driver wall time was 2 min 13 s, including
setup and cleanup. Every harness check
passed: one native launch, fresh sequential workers with one input admission
each, inherited model and thinking settings, independent greeting checks,
fixture tests, `design.md` still absent, no parent model turn, every worker
inactive and cleanup confirmed.

| Worker | Duration | Outcome |
| --- | --- | --- |
| Verifier, conversation 9 | 76 s | `VERDICT: ISSUES`: 2 critical, 3 warnings. Fully correct: quoted `Hello Ada.`, ran `npm test` and probed `greet('')`/`greet()`. |
| Fixer, conversation 48 | 11 s | Minimal correct fix plus empty- and missing-name tests. No design or task edits. Reply ended with prose, not a verdict. |
| Verifier, conversation 77 | 40 s | `VERDICT: CLEAN`. Design Adherence Not applicable. Inspected `git diff`. |

Workers made no tool errors or retries, and every generation stopped
normally. Verifiers ran only read-only `bash` commands (`openspec`,
`cat`, `node --test`, `git diff`). Total use was 96,737 tokens, costing
about $0.009. Despite thinking `high`, reasoning was only 102–624 tokens per
worker.

## Observations worth following up

### The Pi live driver cannot use credentials stored by Pi itself

The driver isolates `PI_CODING_AGENT_DIR`, so `~/.pi/agent/auth.json` is
never visible. Here OpenRouter was set up with an OAuth login that has
`access`, `refresh` and `expires` fields. That is the normal result of Pi's
login, and the driver could not use it. The run needed a separate API key in
the environment. `--help` and `docs/verification.md` do mention this
constraint, but a user who only uses Pi's login has no env key. An opt-in
driver flag that exposes the invoking user's `auth.json` to the isolated
agent dir, linked rather than copied so refreshes stay consistent and the
token never enters evidence, would remove that step. This is the first
observed trigger.

### A thinking-level refusal does not say which levels are valid

`--reasoning-level medium` failed at setup with
`Pi selected another thinking level 'high' !== 'medium'`. GLM 5.3 Flash's
`thinkingLevelMap` supports only `low`, `high` and `max`, so Pi rounded
`medium` up. Refusing is correct, as in the earlier Qwen case, and no worker
started. However, the message gives no supported levels. `get_state` already
returns `thinkingLevelMap`, so the assertion could list its non-null keys.
This is minor.

### Not reproduced: Flint's progress-visibility and markup findings

The longest single generation was 25 s, so the native report never sat
unchanged long enough to raise the busy-versus-stalled question. No reply
contained tool-call markup. These Flint findings are model-specific and
remain open. This run neither confirms nor clears them.
