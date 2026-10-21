# API Specification

## Purpose

This specification defines a REST API that mirrors the capabilities of the vg-task-manager web UI. All operations require a valid JWT token in the `Authorization: Bearer <token>` header, issued via `/api/auth/register` or `/api/auth/login`.

## Requirements

### Requirement: User Authentication

The system SHALL authenticate users via registration and login endpoints, returning JWT tokens and user information including assigned projects for authorized sessions.

#### Scenario: Successful login
- **WHEN** user sends `POST /api/auth/login` with valid credentials
- **THEN** system returns JWT token and user info with assigned `projects` array and status 200

#### Scenario: Failed login
- **WHEN** user sends `POST /api/auth/login` with invalid credentials
- **THEN** system returns error with status 401

#### Scenario: Successful registration
- **WHEN** user sends `POST /api/auth/register` with valid credentials
- **THEN** system creates user with default `projects` assignment and returns user info with status 201

#### Scenario: Duplicate registration
- **WHEN** user sends `POST /api/auth/register` with existing username
- **THEN** system returns error with status 409

### Requirement: Protected API endpoints

The system SHALL require valid JWT authorization and valid project access permissions for all protected endpoints, rejecting unauthorized requests.

#### Scenario: Access protected endpoint without token
- **WHEN** user makes request to protected endpoint without Authorization header
- **THEN** system returns error with status 401

#### Scenario: Access protected endpoint with invalid token
- **WHEN** user makes request to protected endpoint with invalid token
- **THEN** system returns error with status 401

#### Scenario: Access protected endpoint with valid token
- **WHEN** user makes request to protected endpoint with valid Authorization header
- **THEN** system processes request and returns response

#### Scenario: Access project-scoped endpoint without project membership
- **WHEN** user specifies an `X-Project-Id` or `?projectId` for a project they are not a member of
- **THEN** system returns error with status 403

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

### Requirement: Task Type Management

The system SHALL provide access to the task types registered for the active project (`task`, `bug`, `analysis`, `feature`, and `openspec-change` by default).

#### Scenario: List available task types
- **WHEN** user sends `GET /api/task-types` with valid authorization
- **THEN** system returns the list of configured task types for the active project with their id, name, icon, and color including the default `openspec-change` type

#### Scenario: List available task types for project
- **WHEN** user sends `GET /api/task-types` with valid authorization and explicit project context
- **THEN** system returns the list of configured task types for that project with their id, name, icon, and color

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

### Requirement: Attachment Management

The system SHALL manage file attachments for tasks, including upload, retrieval, and deletion.

#### Scenario: List task attachments
- **WHEN** user sends `GET /api/tasks/{id}/attachments`
- **THEN** system returns list of attachments for task

#### Scenario: Upload attachment
- **WHEN** user sends `POST /api/tasks/{id}/attachments` with file
- **THEN** system uploads file and adds to task attachments

#### Scenario: Delete single attachment
- **WHEN** user sends `DELETE /api/tasks/{id}/attachments/{filename}`
- **THEN** system removes specific attachment from task

#### Scenario: Delete all attachments
- **WHEN** user sends `DELETE /api/tasks/{id}/attachments`
- **THEN** system removes all attachments from task

### Requirement: User Management

The system SHALL provide administrative access to list registered user accounts.

#### Scenario: List users
- **WHEN** user sends `GET /api/users`
- **THEN** system returns list of all users (admin functionality)

### Requirement: Tag Management

The system SHALL support retrieving and creating tags associated with tasks.

#### Scenario: List tags
- **WHEN** user sends `GET /api/tags`
- **THEN** system returns all available tags

#### Scenario: Add tag
- **WHEN** user sends `POST /api/tags` with tag name
- **THEN** system creates new tag

### Requirement: Error Handling

The system SHALL return appropriate HTTP status codes and structured error responses for client and server failures.

#### Scenario: Invalid request format
- **WHEN** user sends request with malformed JSON
- **THEN** system returns error with status 400

#### Scenario: Validation failure
- **WHEN** user sends request with invalid field values
- **THEN** system returns validation error with status 400

#### Scenario: Resource not found
- **WHEN** user requests non-existent resource
- **THEN** system returns error with status 404

#### Scenario: Authentication error
- **WHEN** user sends request with invalid or expired token
- **THEN** system returns error with status 401

#### Scenario: Authorization error
- **WHEN** user requests protected resource without permissions
- **THEN** system returns error with status 403

#### Scenario: Server error
- **WHEN** unexpected server error occurs
- **THEN** system returns error with status 500

### Requirement: Project Listing

The system SHALL allow authenticated users to list all projects they are assigned to.

#### Scenario: List assigned projects
- **WHEN** user sends `GET /api/projects` with a valid JWT token
- **THEN** system returns status 200 with a list of projects containing their id, name, and description where the user is an authorized member
