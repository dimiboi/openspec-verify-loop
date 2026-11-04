# Spec Delta

## MODIFIED Requirements

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
