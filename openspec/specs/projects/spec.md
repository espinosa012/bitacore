# projects Specification

## Purpose
Enables multi-project data isolation, allowing users to switch between distinct projects that maintain their own task databases, tags, attachments, and customized task types.

## Requirements

### Requirement: Project Membership and Access

The system SHALL restrict project visibility and operations based on the project identifiers associated with the authenticated user.

#### Scenario: User accesses authorized project
- **WHEN** user requests data for a project listed in their user profile `projects` array
- **THEN** system grants access and executes operations against that project's dedicated database

#### Scenario: User attempts to access unauthorized project
- **WHEN** user requests data for a project not listed in their user profile `projects` array
- **THEN** system rejects the request with an authorization error

#### Scenario: User with no projects
- **WHEN** authenticated user has an empty or unconfigured `projects` array
- **THEN** system presents an empty state indicating no projects are assigned to the account

### Requirement: Project Selection in Web UI

The system SHALL provide a project selector in the application header populated with projects assigned to the authenticated user.

#### Scenario: Initial project selection on login
- **WHEN** user logs in with multiple assigned projects
- **THEN** system populates the project selector with their assigned projects and activates the default or previously active project

#### Scenario: User switches active project
- **WHEN** user selects a different project from the header dropdown
- **THEN** system persists the selection in local storage, connects to the selected project database, and refreshes tasks, tags, and task types

### Requirement: Isolated Project Task Types

The system SHALL load and enforce task types defined within the active project's database collection.

#### Scenario: Load project task types
- **WHEN** active project is switched or initialized
- **THEN** system fetches configured task types from that project's database and updates filter dropdowns, modal selectors, and board card type badges

#### Scenario: Default task types for new projects
- **WHEN** a project database has no existing task types configured
- **THEN** system seeds or falls back to the default task types (task, bug, analysis, feature)
