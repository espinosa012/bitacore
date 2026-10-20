# admin-panel Specification Delta

## Purpose

Enables global administrators to manage users, assign projects, configure project metadata, manage customized task types, and maintain tags with cascading updates.

## ADDED Requirements

### Requirement: Global Administrator Authentication and Landing

The system SHALL identify users with administrative privileges and navigate them directly to the Admin Panel upon authentication.

#### Scenario: Administrator logs in
- **WHEN** user with `isAdmin: true` logs in
- **THEN** system presents the Admin Panel view directly and displays the Admin/Kanban view switch in the application header

#### Scenario: Regular user logs in
- **WHEN** user without administrative privileges logs in
- **THEN** system presents the standard Kanban board view and hides administrative views and navigation controls

### Requirement: First-Run Administrator Bootstrap

The system SHALL present a dedicated initial administrator setup when no users exist in the database, and permanently disable public self-registration once an administrator is created.

#### Scenario: First run with empty users collection
- **WHEN** application connects to database and zero users exist
- **THEN** system displays the Initial Administrator Setup form allowing creation of the first admin account

#### Scenario: Subsequent visits with existing users
- **WHEN** application connects to database and one or more users exist
- **THEN** system presents standard login and hides all public registration forms and links

### Requirement: Administrative User and Project Assignment Management

The system SHALL allow administrators to list users, create new user accounts with credentials, and assign or unassign projects to any user.

#### Scenario: Administrator creates a new user
- **WHEN** administrator submits a new username, password, and assigned projects list
- **THEN** system creates the user record and associates them with the selected projects

#### Scenario: Administrator edits user project assignments
- **WHEN** administrator modifies assigned projects for an existing user
- **THEN** system saves updated project assignments and user's project visibility updates accordingly

### Requirement: Administrative Project Creation

The system SHALL allow administrators to create new projects with dedicated database configurations seeded with default task types and empty tag registries.

#### Scenario: Administrator creates new project
- **WHEN** administrator submits project ID, display name, database name, and optional description
- **THEN** system saves project record in the projects collection and seeds default task types and tag registry in the project database

### Requirement: Project Task Types Management

The system SHALL allow administrators to configure task types for any project and reassign tasks when a task type is deleted.

#### Scenario: Administrator adds or updates task type in project
- **WHEN** administrator saves a task type with name, icon, and color for a selected project
- **THEN** system persists the task type in that project's task types collection

#### Scenario: Administrator deletes a task type in project
- **WHEN** administrator deletes a task type from a project
- **THEN** system deletes the task type and automatically reassigns all existing tasks in that project using that type to the default 'task' type

### Requirement: Project Tags Management and Cascade

The system SHALL allow administrators to manage tags for any project, cascading tag renames and deletions to all tasks in that project.

#### Scenario: Administrator renames project tag
- **WHEN** administrator renames a tag from an old name to a new name in a selected project
- **THEN** system updates the project tag registry and updates all tasks in that project that contain the old tag name to the new tag name

#### Scenario: Administrator deletes project tag
- **WHEN** administrator deletes a tag from a selected project
- **THEN** system removes the tag from the project tag registry and removes the tag from the tags array of all tasks in that project
