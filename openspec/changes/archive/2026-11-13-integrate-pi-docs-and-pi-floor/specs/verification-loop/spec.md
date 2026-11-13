## MODIFIED Requirements

### Requirement: Worker failure ends the run
If a worker session fails, is aborted, is interrupted with a terminal outcome,
or cannot be started, the loop SHALL start no further workers. The host SHALL
report the failure. A host shutdown or crash that suspends unfinished durable
work without a terminal worker outcome SHALL leave the run interrupted rather
than count as a worker failure; such work SHALL resume only on explicit user
request.

#### Scenario: Fixer session fails
- **WHEN** a fixer session ends with an error
- **THEN** no further verifier or fixer starts, and the host reports the error

#### Scenario: Durable host interruption
- **WHEN** Pi closes while unfinished worker work is saved without a terminal outcome
- **THEN** the run remains interrupted, no next worker starts automatically, and explicit resume can recover the existing worker call

#### Scenario: Worker abortion is terminal
- **WHEN** a Pi worker submission settles aborted or failed rather than remaining pending across host interruption
- **THEN** the run ends with that outcome and recovery does not admit the worker prompt again
