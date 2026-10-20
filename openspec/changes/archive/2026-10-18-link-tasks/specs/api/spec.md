# Spec Delta

## MODIFIED Requirements

### Requirement: Task Management

The system SHALL manage tasks with type classification, hierarchy support, and non-hierarchical task linking, including status transitions, metadata filtering, recursive deletion, and link reference cleanup.

#### Scenario: List all tasks
- **WHEN** user sends `GET /api/tasks` with query parameters
- **THEN** system returns paginated list of tasks with tags, type, parentId, linkedTaskIds, and metadata

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
- **THEN** system returns task details including type, parentId, and linkedTaskIds

#### Scenario: Create new task
- **WHEN** user sends `POST /api/tasks` with task data including type, optional parentId, and optional linkedTaskIds
- **THEN** system creates new task and returns with ID

#### Scenario: Update task
- **WHEN** user sends `PUT /api/tasks/{id}` with updated task data
- **THEN** system updates task including linkedTaskIds and returns success confirmation

#### Scenario: Delete task
- **WHEN** user sends `DELETE /api/tasks/{id}`
- **THEN** system deletes the task, all its descendant subtasks recursively, all associated attachments, and cleans up the deleted task's ID from any other tasks' linkedTaskIds
