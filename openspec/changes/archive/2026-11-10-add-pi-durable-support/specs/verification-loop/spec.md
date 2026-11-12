# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: One loop definition for both hosts`
- TO: `### Requirement: One loop definition for all hosts`

## MODIFIED Requirements

### Requirement: One loop definition for all hosts
The loop SHALL be defined once, in a single script file that the bb, OpenCode
and Pi plugins run unchanged. The script SHALL use only the host-provided
`agent`, `phase`, `log`, `args` and `budget` globals, and no clock, randomness,
filesystem, network or imports. Host adapters SHALL NOT duplicate its round,
verdict or prompt decisions.

#### Scenario: Same file on both hosts
- **WHEN** the package is installed on bb and on OpenCode
- **THEN** both hosts run the same `verify-loop.js` file, and that file passes `bb workflows validate --script`

#### Scenario: Same file on all hosts
- **WHEN** the package is installed on bb, OpenCode and Pi
- **THEN** all hosts run the same `verify-loop.js` file, and that file passes `bb workflows validate --script`

#### Scenario: Durable replay on Pi
- **WHEN** Pi recovers an interrupted run
- **THEN** the same script runs with the original arguments and budget, receiving saved worker replies for completed calls
- **AND** recovery introduces no alternative round, verdict or prompt logic

### Requirement: Worker failure ends the run
If a worker session fails, is aborted, is interrupted with a terminal outcome,
or cannot be started, the loop SHALL start no further workers. The host SHALL
report the failure. A host shutdown or crash that suspends unfinished durable
work without a terminal worker outcome SHALL leave the run interrupted rather
than count as a worker failure; such work SHALL resume only on explicit user
request. Existing bb and OpenCode failure handling SHALL remain unchanged.

#### Scenario: Fixer session fails
- **WHEN** a fixer session ends with an error
- **THEN** no further verifier or fixer starts, and the host reports the error

#### Scenario: Durable host interruption
- **WHEN** Pi closes while unfinished worker work is saved without a terminal outcome
- **THEN** the run remains interrupted, no next worker starts automatically, and explicit resume can recover the existing worker call

#### Scenario: Worker abortion is terminal
- **WHEN** a Pi worker submission settles aborted or failed rather than remaining pending across host interruption
- **THEN** the run ends with that outcome and recovery does not admit the worker prompt again
