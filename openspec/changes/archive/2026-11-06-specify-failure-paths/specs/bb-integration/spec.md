## MODIFIED Requirements

### Requirement: Skill starts one workflow
Invoking the `openspec-verify-loop` skill SHALL submit the shared loop script
once with `bb workflows run --script`. It SHALL then post the workflow preview
directive built from the returned run ID, and end the turn without waiting for
the run. If the command fails, the skill SHALL report its error and SHALL NOT
retry the start or start a workflow another way.

#### Scenario: Start with a change
- **WHEN** the user runs `/openspec-verify-loop add-export`
- **THEN** exactly one workflow run starts with `change` set to `add-export` in its arguments
- **AND** the reply contains one `::workflow-preview{run="<runId>"}` line for that run

#### Scenario: Optional arguments
- **WHEN** the user supplies `--store <id>` or `--max-rounds <n>`
- **THEN** the workflow arguments carry that store or round limit unchanged

#### Scenario: Workflow start fails
- **WHEN** `bb workflows run` exits with an error, for example because the Workflows plugin is disabled
- **THEN** the thread reports that error, posts no preview, and starts no other workflow

### Requirement: Procedure path from the starting thread
The skill SHALL pass the absolute path of the `openspec-verify-change` skill
file that the starting thread can see in the workflow arguments. If the
starting thread can see no such skill, the skill SHALL report that the OpenSpec
verify workflow must be installed and SHALL start no workflow.

#### Scenario: Path passed
- **WHEN** the starting thread lists an `openspec-verify-change` skill at an absolute path
- **THEN** the workflow arguments contain that path as the procedure path

#### Scenario: Verify skill missing
- **WHEN** neither the starting thread's skill list nor `bb skill list --json` contains an `openspec-verify-change` skill
- **THEN** the thread reports that the OpenSpec verify workflow must be installed and starts no workflow
