## MODIFIED Requirements

### Requirement: Pi package entry
The package SHALL install as a native Pi package with explicit extension resources and Node.js >=22.19 support. Pi SHALL NOT expose the bb-specific loop skill. Installing or loading the extension SHALL start no loop or worker. Start and resume SHALL require Pi 1.5.2 or later and refuse an older or unparseable Pi version, naming the version found; report and stop SHALL remain available on any Pi version. The package SHALL also keep its bb entry and OpenCode default export.

#### Scenario: Install on Pi
- **WHEN** a user installs the package from Git and starts Pi
- **THEN** its loop commands are available without a build during installation
- **AND** no loop starts and the bb-specific workflow skill is not exposed by this package

#### Scenario: Other hosts load their entries
- **WHEN** bb or OpenCode loads the installed package
- **THEN** it retains its existing entry and does not initialize a Pi harness

#### Scenario: Newer Pi
- **WHEN** a user starts or resumes a loop on a Pi version later than 1.5.2, such as 1.5.3 or 1.6.0
- **THEN** the command proceeds as it does on Pi 1.5.2

#### Scenario: Older Pi
- **WHEN** a user starts or resumes a loop on Pi 1.5.1
- **THEN** the command fails with "Pi loop requires Pi 1.5.2 or later; found 1.5.1" and starts no worker
- **AND** report and stop still work on that Pi
