# Spec Delta

## MODIFIED Requirements

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

### Requirement: Task Type Management

The system SHALL provide access to registered task types configured in the active project database (`task`, `bug`, `analysis`, `feature`).

#### Scenario: List available task types
- **WHEN** user sends `GET /api/task-types` with valid authorization
- **THEN** system returns the list of configured task types for the active project with their id, name, icon, and color

#### Scenario: List available task types for project
- **WHEN** user sends `GET /api/task-types` with valid authorization and explicit project context
- **THEN** system returns the list of configured task types for that project with their id, name, icon, and color

## ADDED Requirements

### Requirement: Project Listing

The system SHALL allow authenticated users to list all projects they are assigned to.

#### Scenario: List assigned projects
- **WHEN** user sends `GET /api/projects` with a valid JWT token
- **THEN** system returns status 200 with a list of projects containing their id, name, and description where the user is an authorized member
