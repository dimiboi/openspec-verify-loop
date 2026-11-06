# Proposal

## Why

The specs describe the main failure paths, but the plugin handles many more that no requirement names: host connection failures, worker sessions that cannot be created or do not match, unexpected worker input, unreadable transcripts, workers that end unsuccessfully, undelivered results and invalid arguments. Without a requirement, a regression in any of them can pass verification. Two of these paths changed recently: a failed read before submission now keeps its cause, and an unreconciled submission names its error.

## What Changes

- List every failure path of the OpenCode plugin as a scenario: invalid options and arguments, starts refused while unloading or outside a Git checkout, host connection failures, model and skill discovery failures, worker creation and identity failures, prompt-submission failures, unsuccessful worker endings, unreadable transcripts and undelivered results.
- Specify the existing `report` action and `/opsx-verify-loop-report` command, which recover undelivered results.
- Specify that the shared loop rejects an invalid round limit before starting a worker.
- Shorten the report-text requirement of the shared loop to its rules, without changing them; its scenarios keep the examples.
- Specify the bb skill's behavior when the verify skill is missing or `bb workflows run` fails, and add the missing instruction not to retry a failed start to the bb skill.
- Add a deterministic test for every new scenario that has none.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-integration`: Name every start, connection, worker, submission, observation and delivery failure, and the report action.
- `verification-loop`: Name the invalid round limit, and shorten the report-text requirement without changing it.
- `bb-integration`: Name the missing verify skill and a failed workflow start.

## Impact

Spec files under `openspec/`, one instruction in `skills/openspec-verify-loop/SKILL.md`, and new fake-host tests in `tests/`. No change to plugin behavior, dependencies or configuration.
