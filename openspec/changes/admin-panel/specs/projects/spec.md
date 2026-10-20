# projects Specification Delta

## MODIFIED Requirements

### Requirement: Project Membership and Access

The system SHALL restrict project visibility and operations based on user project identifiers, while granting global administrators access to all projects.

#### Scenario: User accesses authorized project
- **WHEN** user requests data for a project listed in their user profile `projects` array
- **THEN** system grants access and executes operations against that project's dedicated database

#### Scenario: User attempts to access unauthorized project
- **WHEN** non-admin user requests data for a project not listed in their user profile `projects` array
- **THEN** system rejects the request with an authorization error

#### Scenario: User with no projects
- **WHEN** authenticated non-admin user has an empty or unconfigured `projects` array
- **THEN** system presents an empty state indicating no projects are assigned to the account

#### Scenario: Administrator accesses any project
- **WHEN** user with `isAdmin: true` requests data for any existing project
- **THEN** system grants access and executes operations regardless of the user profile `projects` array

## ADDED Requirements

### Requirement: Administrative Project Creation

The system SHALL support creating new projects with initialized metadata, task types, and tag registry.

#### Scenario: Administrator creates new project record
- **WHEN** administrator creates a new project specifying id, name, and dbName
- **THEN** system inserts project document into projects collection and ensures default task types and empty tag registry exist in the project database
