# API Specification

## Purpose

This specification defines a REST API that mirrors the capabilities of the vg-task-manager web UI. All operations require a valid JWT token in the `Authorization: Bearer <token>` header, issued via `/api/auth/register` or `/api/auth/login`.

## Requirements

### Requirement: User Authentication

#### Scenario: Successful login
- **WHEN** user sends `POST /api/auth/login` with valid credentials
- **THEN** system returns JWT token and user info with status 200

#### Scenario: Failed login
- **WHEN** user sends `POST /api/auth/login` with invalid credentials
- **THEN** system returns error with status 401

#### Scenario: Successful registration
- **WHEN** user sends `POST /api/auth/register` with valid credentials
- **THEN** system creates user and returns user info with status 201

#### Scenario: Duplicate registration
- **WHEN** user sends `POST /api/auth/register` with existing username
- **THEN** system returns error with status 409

### Requirement: Protected API endpoints

#### Scenario: Access protected endpoint without token
- **WHEN** user makes request to protected endpoint without Authorization header
- **THEN** system returns error with status 401

#### Scenario: Access protected endpoint with invalid token
- **WHEN** user makes request to protected endpoint with invalid token
- **THEN** system returns error with status 401

#### Scenario: Access protected endpoint with valid token
- **WHEN** user makes request to protected endpoint with valid Authorization header
- **THEN** system processes request and returns response

### Requirement: Task Management

#### Scenario: List all tasks
- **WHEN** user sends `GET /api/tasks` with query parameters
- **THEN** system returns paginated list of tasks with tags and metadata

#### Scenario: Get single task
- **WHEN** user sends `GET /api/tasks/{id}` with valid task ID
- **THEN** system returns task details

#### Scenario: Create new task
- **WHEN** user sends `POST /api/tasks` with task data
- **THEN** system creates new task and returns with ID

#### Scenario: Update task
- **WHEN** user sends `PUT /api/tasks/{id}` with updated task data
- **THEN** system updates task and returns success confirmation

#### Scenario: Delete task
- **WHEN** user sends `DELETE /api/tasks/{id}`
- **THEN** system deletes task and associated attachments

### Requirement: Attachment Management

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

#### Scenario: List users
- **WHEN** user sends `GET /api/users`
- **THEN** system returns list of all users (admin functionality)

### Requirement: Tag Management

#### Scenario: List tags
- **WHEN** user sends `GET /api/tags`
- **THEN** system returns all available tags

#### Scenario: Add tag
- **WHEN** user sends `POST /api/tags` with tag name
- **THEN** system creates new tag

### Requirement: Error Handling

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