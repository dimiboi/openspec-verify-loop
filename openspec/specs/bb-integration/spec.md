# bb-integration Specification

## Purpose

Lets a bb user install the verification loop as a bb plugin, start it from a
thread with the `openspec-verify-loop` skill, and have it run as a bb workflow
using that thread's model.

## Requirements

### Requirement: bb plugin package
The package SHALL install as a bb plugin from its Git repository. It SHALL
declare the required server entry and provide the `openspec-verify-loop`
skill. The server entry SHALL register only an agent configuration that hides
the skill from bb Workflows worker threads and keeps it for every other thread.
Installing, loading or reloading the plugin SHALL start no workflow.

#### Scenario: Install
- **WHEN** the user installs the package with `bb plugin install`
- **THEN** bb loads the plugin, the `openspec-verify-loop` skill becomes available, and no workflow is started

#### Scenario: Workflow worker
- **WHEN** bb starts a thread whose origin is the Workflows plugin, such as a verifier or fixer of a running loop
- **THEN** that thread's skill list does not contain `openspec-verify-loop`

#### Scenario: Other threads
- **WHEN** bb starts a thread with any other origin, such as one the user started, a side chat, or a thread another plugin spawned
- **THEN** that thread's skill list contains `openspec-verify-loop`

### Requirement: Skill starts one workflow
Invoking the `openspec-verify-loop` skill SHALL submit the shared loop script
once with `bb workflows run --script`. It SHALL then post the workflow preview
directive built from the returned run ID, and end the turn without waiting for
the run.

#### Scenario: Start with a change
- **WHEN** the user runs `/openspec-verify-loop add-export`
- **THEN** exactly one workflow run starts with `change` set to `add-export` in its arguments
- **AND** the reply contains one `::workflow-preview{run="<runId>"}` line for that run

#### Scenario: Optional arguments
- **WHEN** the user supplies `--store <id>` or `--max-rounds <n>`
- **THEN** the workflow arguments carry that store or round limit unchanged

### Requirement: Procedure path from the starting thread
The skill SHALL pass the absolute path of the `openspec-verify-change` skill
file that the starting thread can see in the workflow arguments.

#### Scenario: Path passed
- **WHEN** the starting thread lists an `openspec-verify-change` skill at an absolute path
- **THEN** the workflow arguments contain that path as the procedure path

### Requirement: Workers inherit the starting thread's settings
The loop SHALL name no provider, model or reasoning level, so that every worker
inherits the starting thread's provider, model, reasoning level and permission
mode through Workflows.

#### Scenario: Started from a local Flint thread
- **WHEN** the loop starts from a thread running local Flint with medium reasoning in `full` mode
- **THEN** every verifier and fixer runs on Flint with medium reasoning in `full` mode

#### Scenario: Started from a Claude thread
- **WHEN** the loop starts from a Claude thread in `auto` mode
- **THEN** every worker runs on the same Claude model and reasoning level in `auto` mode

### Requirement: Supported permission modes are documented
The skill and the README SHALL state that a bb loop must start from a thread in
`auto` or `full` mode. They SHALL explain that a mode which asks before shell
commands, such as `accept-edits`, stalls hidden workers. They SHALL also state
that ACP providers such as local Flint need `full`. The plugin does not enforce
the mode in this change.

#### Scenario: Precondition stated
- **WHEN** a user reads the bb skill or the README's bb section
- **THEN** it states that `auto` or `full` is required, that `accept-edits` stalls workers, and that local Flint needs `full`

### Requirement: Completion report
When the workflow's completion notice arrives, the starting thread SHALL report
the run's status, change, round count and reason, plus the last report or a
pointer to it. It SHALL never start, resume or stop a run in response to the
notice.

#### Scenario: Clean completion
- **WHEN** the completion notice for a run reports status `clean`
- **THEN** the thread reports the clean result and the run ID, and submits no new workflow

#### Scenario: Large result
- **WHEN** the notice omits or truncates the run's result
- **THEN** the thread reads the result with `bb workflows status <runId>`, or points the user to the workflow preview

### Requirement: Stop
When the user asks to stop a running loop, the starting thread SHALL run
`bb workflows stop <runId>` and report the resulting status.

#### Scenario: User stops the loop
- **WHEN** the user asks to stop the loop during a fix
- **THEN** the thread runs `bb workflows stop` for that run ID and reports the stopped status
