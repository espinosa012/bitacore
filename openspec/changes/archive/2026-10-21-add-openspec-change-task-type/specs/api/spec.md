# Spec Delta: api

## MODIFIED Requirements

### Requirement: Task Type Management

The system SHALL provide access to the task types registered for the active project (`task`, `bug`, `analysis`, `feature`, and `openspec-change` by default).

#### Scenario: List available task types
- **WHEN** user sends `GET /api/task-types` with valid authorization
- **THEN** system returns the list of configured task types for the active project with their id, name, icon, and color including the default `openspec-change` type

#### Scenario: List available task types for project
- **WHEN** user sends `GET /api/task-types` with valid authorization and explicit project context
- **THEN** system returns the list of configured task types for that project with their id, name, icon, and color
