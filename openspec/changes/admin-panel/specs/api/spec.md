# API Specification Delta

## MODIFIED Requirements

### Requirement: User Authentication

The system SHALL authenticate users via login endpoints, returning JWT tokens and user information including assigned projects and admin status for authorized sessions, while restricting registration to first-run bootstrap or administrative callers.

#### Scenario: Successful login
- **WHEN** user sends `POST /api/auth/login` with valid credentials
- **THEN** system returns JWT token and user info with assigned `projects` array, `isAdmin` status, and status 200

#### Scenario: Failed login
- **WHEN** user sends `POST /api/auth/login` with invalid credentials
- **THEN** system returns error with status 401

#### Scenario: Initial administrator bootstrap registration
- **WHEN** user sends `POST /api/auth/bootstrap` with valid admin credentials and database has zero users
- **THEN** system creates the initial administrator user with `isAdmin: true` and returns status 201 with JWT token

#### Scenario: Bootstrap registration attempted after initial user exists
- **WHEN** user sends `POST /api/auth/bootstrap` and database already contains one or more users
- **THEN** system rejects registration with error and status 403

#### Scenario: Public registration rejected
- **WHEN** user sends `POST /api/auth/register` without valid administrator authorization
- **THEN** system rejects registration with authorization error and status 403

## ADDED Requirements

### Requirement: Administrative User Management Endpoints

The system SHALL provide administrative endpoints to list, create, update, and delete user accounts and project assignments.

#### Scenario: Administrator creates user via API
- **WHEN** authorized administrator sends `POST /api/admin/users` with username, password, and project list
- **THEN** system creates user with assigned projects and returns status 201

#### Scenario: Non-admin attempts to create user
- **WHEN** non-admin user sends `POST /api/admin/users`
- **THEN** system rejects request with status 403

#### Scenario: Administrator updates user project assignments
- **WHEN** authorized administrator sends `PUT /api/admin/users/{username}` with updated projects array
- **THEN** system updates user's projects and returns status 200

### Requirement: Administrative Task Types and Tags Cascade Endpoints

The system SHALL provide administrative endpoints to modify project task types and tags with automatic cascading updates to existing tasks.

#### Scenario: Administrator deletes task type with automatic cascade
- **WHEN** authorized administrator sends `DELETE /api/projects/{projectId}/task-types/{typeId}`
- **THEN** system deletes the task type and updates tasks using that type in that project to type 'task'

#### Scenario: Administrator renames tag with automatic cascade
- **WHEN** authorized administrator sends `PUT /api/projects/{projectId}/tags/{oldTag}` with new tag name and color
- **THEN** system updates registry and updates all matching tasks in that project to the new tag name

#### Scenario: Administrator deletes tag with automatic cascade
- **WHEN** authorized administrator sends `DELETE /api/projects/{projectId}/tags/{tagName}`
- **THEN** system removes tag from registry and pulls tag from all tasks in that project
