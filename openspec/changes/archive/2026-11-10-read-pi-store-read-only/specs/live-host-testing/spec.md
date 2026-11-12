## MODIFIED Requirements

### Requirement: Pi native entry and isolation
The Pi driver SHALL load the tested package snapshot in a fixture-scoped Pi process, use its native loop commands, and record Pi and Durable versions. It SHALL leave the user's package configuration unchanged, verify procedure provenance and inherited worker settings, and collect run/submission identities and complete reports. While the host may run, the driver SHALL only read run records, through a read-only store open. Closing the driver SHALL clean up only the processes and runs it owns.

#### Scenario: Native Pi launch
- **WHEN** the Pi fix-to-clean attempt starts
- **THEN** the installed extension's native start command launches one run with the selected change, procedure and model settings
- **AND** independent greeting checks, sequential fresh workers and absence of `design.md` determine success alongside the terminal result
- **AND** worker transcripts are inspected under exclusive checkout ownership only after the host has stopped

#### Scenario: Missing Pi prerequisite
- **WHEN** Pi, the required runtime, verify procedure or selected provider/model is unavailable
- **THEN** setup reports the prerequisite error and does not install or reconfigure the user's global packages or substitute a model
