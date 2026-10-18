# Spec Delta

## MODIFIED Requirements

### Requirement: Task Management

The system SHALL manage tasks with type classification and hierarchy support, including status transitions, metadata filtering, and recursive deletion.

#### Scenario: List all tasks
- **WHEN** user sends `GET /api/tasks` with query parameters
- **THEN** system returns paginated list of tasks with tags, type, parentId, and metadata

#### Scenario: Filter tasks by favorite
- **WHEN** user sends `GET /api/tasks?favorite=true`
- **THEN** system returns only tasks that are marked as favorite

#### Scenario: Filter tasks by type
- **WHEN** user sends `GET /api/tasks?type={typeName}`
- **THEN** system returns only tasks matching the requested type

#### Scenario: Filter tasks by parent ID
- **WHEN** user sends `GET /api/tasks?parentId={parentId}`
- **THEN** system returns only direct subtasks belonging to that parent

#### Scenario: Get single task
- **WHEN** user sends `GET /api/tasks/{id}` with valid task ID
- **THEN** system returns task details including type and parentId

#### Scenario: Create new task
- **WHEN** user sends `POST /api/tasks` with task data including type and optional parentId
- **THEN** system creates new task and returns with ID

#### Scenario: Update task
- **WHEN** user sends `PUT /api/tasks/{id}` with updated task data
- **THEN** system updates task and returns success confirmation

#### Scenario: Delete task
- **WHEN** user sends `DELETE /api/tasks/{id}`
- **THEN** system deletes the task, all its descendant subtasks recursively, and all associated attachments

## ADDED Requirements

### Requirement: Task Type Management

The system SHALL provide access to registered task types configured in the database (`task`, `bug`, `analysis`, `feature`).

#### Scenario: List available task types
- **WHEN** user sends `GET /api/task-types` with valid authorization
- **THEN** system returns the list of configured task types with their id, name, icon, and color

### Requirement: Subtask Hierarchy Validation

The system SHALL enforce hierarchy constraints preventing circular dependencies, sibling subtasking, and multiple parents.

#### Scenario: Prevent self-referencing subtask
- **WHEN** user attempts to set a task's parentId to its own ID
- **THEN** system rejects the operation with status 400

#### Scenario: Prevent circular ancestry
- **WHEN** user attempts to set parentId to a descendant or ancestor that would cause a cycle
- **THEN** system rejects the operation with status 400

#### Scenario: Prevent sibling subtask assignment
- **WHEN** user attempts to assign a sibling task (sharing the same parentId) as a subtask of another sibling
- **THEN** system rejects the operation with status 400
