## Purpose

Provides a friendly greeting for a named user or a visitor without a name.

## ADDED Requirements

### Requirement: Named greeting
`greet(name)` SHALL return `Hello, <name>!` for a non-empty name.

#### Scenario: Named user
- **WHEN** `greet('Ada')` is called
- **THEN** the result is `Hello, Ada!`

### Requirement: Default greeting
`greet(name)` SHALL return `Hello, world!` when the name is empty or missing.

#### Scenario: Empty name
- **WHEN** `greet('')` is called
- **THEN** the result is `Hello, world!`

#### Scenario: Missing name
- **WHEN** `greet()` is called
- **THEN** the result is `Hello, world!`
