# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit live execution
The repository SHALL provide separate opt-in live-test commands for bb,
OpenCode and Pi, supporting `fix-to-clean` and `stop` scenarios. Pi SHALL also
support a `resume` scenario. Live execution SHALL require a selected model and
SHALL remain outside the default deterministic checks and distributed plugin
resources.

#### Scenario: Ordinary development check
- **WHEN** a maintainer runs `npm run check`
- **THEN** no live-test driver contacts a host, starts a workflow or session, or requests a model response

#### Scenario: Explicit scenario
- **WHEN** a maintainer invokes a live command with a host, supported scenario and available selected model
- **THEN** the harness executes one attempt of that scenario and reports its evidence location

#### Scenario: Pi resume scenario selected
- **WHEN** a maintainer explicitly invokes the Pi live command with scenario `resume` and a selected model
- **THEN** it tests interruption and explicit recovery as one retained attempt rather than launching a replacement loop

### Requirement: Active-worker stop
The stop scenario SHALL first observe an active worker, then request stop
through the normal host interface: a user stop request to the bb starting
thread or OpenCode's or Pi's native stop command. It SHALL pass only after the
host reports cancellation/stopped, the worker is confirmed inactive and no
subsequent worker is started. Emergency cleanup SHALL NOT count as exercising
the normal stop path.

#### Scenario: Stop while active
- **WHEN** a stop request reaches the loop while a worker is active
- **THEN** the scenario checks the terminal result and worker inactivity and reports pass only when the normal stop path succeeds

#### Scenario: Worker finished before stop
- **WHEN** the run completes before the stop request can exercise active cancellation
- **THEN** the attempt reports that stop was not exercised and exits unsuccessfully rather than claiming a stop pass or automatically starting another run

## ADDED Requirements

### Requirement: Pi native entry and isolation
The Pi driver SHALL load the tested package snapshot in a fixture-scoped Pi process, use its native loop commands, and record Pi and Durable versions. It SHALL leave the user's package configuration unchanged, verify procedure provenance and inherited worker settings, and collect run/submission identities and complete reports. Closing the driver SHALL clean up only the processes and runs it owns.

#### Scenario: Native Pi launch
- **WHEN** the Pi fix-to-clean attempt starts
- **THEN** the installed extension's native start command launches one run with the selected change, procedure and model settings
- **AND** independent greeting checks, sequential fresh workers and absence of `design.md` determine success alongside the terminal result

#### Scenario: Missing Pi prerequisite
- **WHEN** Pi, the required runtime, verify procedure or selected provider/model is unavailable
- **THEN** setup reports the prerequisite error and does not install or reconfigure the user's global packages or substitute a model

### Requirement: Pi interruption and explicit resume evidence
The Pi resume scenario SHALL interrupt a run after at least one completed worker call and while another call is unfinished, reopen its saved state, inspect without continuing, and explicitly resume the same run. Success SHALL require no repeated completed worker, no duplicate prompt admission, an unchanged budget, a clean final result, independent fixture checks and confirmed cleanup. Missing interruption evidence SHALL fail the attempt.

#### Scenario: Resume an interrupted run
- **WHEN** the driver restarts its Pi host after interrupting a known run and then requests report
- **THEN** saved worker identities and replies remain available and observation schedules no model or worker tools
- **AND** an explicit resume continues the same run, reuses the unfinished call and launches only subsequent new workers

#### Scenario: Replayed fix is detected
- **WHEN** recovery creates a second conversation for a completed call, admits an existing worker prompt again or resets the original round limit
- **THEN** the attempt fails even if the final report says clean

#### Scenario: Resume was not exercised
- **WHEN** the run finishes before a completed call and an unfinished call can be observed at interruption
- **THEN** the attempt records that resume was not exercised and exits unsuccessfully without starting another run

#### Scenario: Old execution remains uncertain
- **WHEN** the driver cannot confirm its pre-restart worker processes are inactive
- **THEN** it retains the fixture and evidence and reports cleanup failure instead of resuming overlapping work
