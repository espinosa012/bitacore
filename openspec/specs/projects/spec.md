# projects Specification

## Purpose
Enables multiple projects to live in a single shared database. Every task belongs to exactly one project through a hidden `project` field, and users switch between the projects they belong to.

## Requirements

### Requirement: Shared Project Database

The system SHALL store all projects in the single `vg-task-manager` database and scope data by project identifier instead of by database.

#### Scenario: Task belongs to a project
- **WHEN** a task is stored
- **THEN** its document carries a `project` field holding the owning project's id

#### Scenario: Per-project tag registry and task types
- **WHEN** tags or task types are stored for a project
- **THEN** the tag registry is the `tags` document with `_id` `registry:<projectId>` and each task type is a `task_types` document with `_id` `<projectId>:<typeId>` and a `project` field

#### Scenario: Task ids are unique across projects
- **WHEN** a task is saved with an id already owned by another project
- **THEN** the system rejects the write instead of overwriting the other project's task

#### Scenario: Migration from per-project databases
- **WHEN** the application connects to a database that still uses the previous layout (tasks without `project`, an unscoped `registry` tag document, unscoped task types, or projects with a `dbName`)
- **THEN** the system assigns unscoped data to `project-ludum`, copies tasks, task types and tags from each project's old database into the shared database, records `migratedFromDb` on the project and removes its `dbName`; attachments of copied tasks keep a `database` field pointing to the old database where their files remain

### Requirement: Project Membership and Access

The system SHALL restrict project visibility and operations based on the project identifiers associated with the authenticated user.

#### Scenario: User accesses authorized project
- **WHEN** user requests data for a project listed in their user profile `projects` array
- **THEN** system grants access and only reads or writes documents whose `project` matches that project

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
- **THEN** system populates the project selector with their assigned projects and activates the previously active project, or the first one

#### Scenario: User switches active project
- **WHEN** user selects a different project from the header dropdown
- **THEN** system persists the selection in local storage and reloads the tasks, tags and task types of the selected project from the shared database

#### Scenario: Project assigned on task creation
- **WHEN** user creates a task or subtask
- **THEN** system sets its `project` field to the active project without showing the field in the UI

### Requirement: Isolated Project Task Types

The system SHALL load and enforce the task types defined for the active project.

#### Scenario: Load project task types
- **WHEN** active project is switched or initialized
- **THEN** system fetches the task types whose `project` is the active project and updates filter dropdowns, modal selectors, and board card type badges

#### Scenario: Default task types for new projects
- **WHEN** a project is created or has no task types configured
- **THEN** system seeds or falls back to the default task types (task, bug, analysis, feature, openspec-change)
