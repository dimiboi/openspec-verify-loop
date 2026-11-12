# Pi with local Flint: monitored dummy-repository run

## Setup

Run on 2026-11-10 from commit `41e2920`, with Node 26.13.0, Pi and Pi Durable
1.5.0 and the installed LM Studio provider extension. The model was
`lmstudio/recursivesi/flint` (Q6_K), already loaded with context 262,144 and
parallelism 1, at Pi thinking `medium`. No model-server or global Pi settings
were changed; Flint stayed loaded afterwards.

```sh
npm run test:live:pi -- --scenario fix-to-clean \
  --provider lmstudio --model recursivesi/flint --reasoning-level medium \
  --procedure "$PWD/.agents/skills/openspec-verify-change/SKILL.md" \
  --provider-extension /Users/dmitry/.pi/agent/git/github.com/rhythmerc/pi-provider-lmstudio \
  --timeout 3600 --cleanup-timeout 60 --output "$BB_THREAD_STORAGE/flint-pi-live"
```

Preflight `npm ci` and `npm run check` passed: 170 deterministic tests (see
the npm cache note below). Evidence:
`/Users/dmitry/.bb/thread-storage/thr_pvbyys5ecg/flint-pi-live/`, with the
attempt in `loop-live-pi-MBpHzl/` and LM Studio per-response stats in
`lmstudio-stream.jsonl`.

## Outcome

**Passed.** Run `run_1a1c2ab12a08247eed95c434d208dd2456680ef4da0` ended
`clean` after 2 verifications in 22 min 34 s. Every harness check passed: one
native launch, fresh sequential workers with one input admission each,
inherited model and thinking settings, independent greeting checks, fixture
tests, `design.md` still absent, no parent model turn, every worker inactive
and cleanup confirmed.

| Worker | Duration | Outcome |
| --- | --- | --- |
| Verifier, conversation 9 | 13 min 3 s | `VERDICT: ISSUES`: 1 critical, 2 warnings. Correct, apart from quoting `greet('Ada')` as `Hello Ada!` instead of `Hello Ada.`. |
| Fixer, conversation 56 | 2 min 27 s | Minimal correct fix plus two default-greeting tests; no design created. |
| Verifier, conversation 141 | 7 min 3 s | `VERDICT: CLEAN`; Design Adherence Not applicable. |

LM Studio served 28 responses: 54,158 output tokens in 1,314 s, about 97% of
worker time, at 40–49 tokens/s.

## Observations worth following up

### Native reports still cannot distinguish a busy worker from a stalled one

Report revision 4 stayed unchanged from 01:36 to 01:49 while the first
verifier's final response generated for 605 s. Telling progress from a hang
needed `lms ps`, the LM Studio log stream and the worker's socket list. This
observation is the trigger for the last-worker-activity line in Pi reports.

### Flint leaked tool-call markup into a final reply

The fixer's final reply (`eosFound`, not a tool call) ended
`VERDICT: CLEAN</arg_value></tool_call>`: the model emitted closing tool-call
tags with no opening tag, and LM Studio passed them through as text. The
fixer also added a verdict line it was not asked for, apparently copying the
report's format. Both were harmless here, because fixer replies are only
checked for `VERDICT: BLOCKED`. If a verifier reply ended this way, its last
line would not match a verdict and the run would end `blocked` (safe, not a
false clean). Both verifier replies were clean of markup. Watch for it on a
verifier before stripping model-specific markup in `lastLine`.

### Medium thinking still produces very long single responses

The two slowest responses were the verifiers' final report turns: 23,908
output tokens in 605 s, and 8,912 in 211 s, each about 93–98% thinking by
character count. That is model behavior, not a loop defect. It is the dominant
cost and is relevant to
[C25](future-improvements.md#workers-that-wait-or-misbehave), though this run
finished well inside its deadline.

### `npm run check` depends on the user's default npm cache

With the default `~/.npm` cache, the offline snapshot test
(`runnable snapshot resolves external dependencies offline…` in
`tests/live-opencode.test.ts`) failed with `ENOTCACHED` for
`@silvia-odwyer/photon-0.3.3.tgz`. Rerunning with
`npm_config_cache` set to the cache that `npm ci` had just filled passed. The
suite's result depends on machine cache state. Either document running both
commands with the same cache, or have the test use the cache `npm ci` filled.

### Not an issue: transient bb-spawned Pi

At 01:46 a second `pi` process appeared, started by bb's provider-bridge
worker with this worktree as its working directory. It had no LM Studio
connection, the model log shows no foreign requests, and it exited within
about a minute. The loop's isolated agent directory was not affected.

The earlier harness-timeout and readiness-test findings were not exercised by
this run.
