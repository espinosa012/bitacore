# Spec Delta: projects

## MODIFIED Requirements

### Requirement: Isolated Project Task Types

The system SHALL load and enforce the task types defined for the active project.

#### Scenario: Load project task types
- **WHEN** active project is switched or initialized
- **THEN** system fetches the task types whose `project` is the active project and updates filter dropdowns, modal selectors, and board card type badges

#### Scenario: Default task types for new projects
- **WHEN** a project is created or has no task types configured
- **THEN** system seeds or falls back to the default task types (task, bug, analysis, feature, openspec-change)
