# API Specification

## Overview

This specification defines a REST API that mirrors the capabilities of the vg-task-manager web UI. All operations require a valid JWT token in the `Authorization: Bearer <token>` header, issued via `/api/auth/register` or `/api/auth/login`.

## Authentication

### Login & Token Format

- **Login**: `POST /api/auth/login` with JSON body `{ "username": "...", "password": "..." }`
- **Response**: `{ "ok": true, "token": "jwt-here", "user": { "username": "..." } }`
- **Token**: Signed with `API_JWT_SECRET` (env var, default `vg-task-manager-secret-key`). Contains:
  - `username`: user's username
  - `iat`: issued at timestamp
  - `exp`: expires in 24 hours

### Registration

- **Register**: `POST /api/auth/register` with JSON body `{ "username": "...", "password": "..." }`
- **Response**: `{ "ok": true, "user": { "username": "..." } }`

### Authenticated Requests

- All protected endpoints require `Authorization: Bearer <jwt>` header
- Invalid/missing tokens return `401 Unauthorized`

## Endpoints

### Auth

| Method | Endpoint | Description | Body | Response |
|--------|----------|-------------|------|----------|
| POST | `/api/auth/register` | Register a new user | `{ "username": "...", "password": "..." }` | `201 { "ok": true, "user": { "username": "..." } }` |
| POST | `/api/auth/login` | Log in with username/password | `{ "username": "...", "password": "..." }` | `200 { "ok": true, "token": "...", "user": { "username": "..." } }` |
| POST | `/api/auth/logout` | Log out (invalidates token client-side) | - | `200 { "ok": true }` |

### Users

| Method | Endpoint | Description | Body | Response |
|--------|----------|-------------|------|----------|
| GET | `/api/users` | List all users (admin only) | - | `200 { "ok": true, "users": [ { "username": "..." } ] }` |

### Tasks

| Method | Endpoint | Description | Body | Response |
|--------|----------|-------------|------|----------|
| GET | `/api/tasks` | List all tasks (paginated) | `?search=...&status=...&priority=...&tag=...&assignee=...&limit=...&offset=...` | `200 { "ok": true, "tasks": [ { ... } ] }` |
| POST | `/api/tasks` | Create a new task | `{ "name": "...", "description": "...", "status": "...", "priority": "...", "tags": [...] }` | `201 { "ok": true, "task": { "id": "...", "created_at": "...", ... } }` |
| GET | `/api/tasks/{id}` | Get task by ID | - | `200 { "ok": true, "task": { "id": "...", ... } }` |
| PUT | `/api/tasks/{id}` | Update task (name, description, status, assignee, tags) | `{ "name": "...", "description": "...", "status": "...", "priority": "...", "tags": [...] }` | `200 { "ok": true }` |
| DELETE | `/api/tasks/{id}` | Delete task and its attachments | - | `200 { "ok": true }` |

### Attachments

| Method | Endpoint | Description | Body | Response |
|--------|----------|-------------|------|----------|
| POST | `/api/tasks/{id}/attachments` | Upload attachment file | `multipart/form-data` with `file` (and optional `database` field) | `200 { "ok": true, "fileId": "...", "filename": "...", "size": ... }` |
| GET | `/api/tasks/{id}/attachments` | List attachments for a task | - | `200 { "ok": true, "attachments": [ { "filename": "...", "size": ... } ] }` |
| DELETE | `/api/tasks/{id}/attachments/{filename}` | Delete single attachment | - | `200 { "ok": true }` |
| DELETE | `/api/tasks/{id}/attachments` | Delete all attachments for a task | - | `200 { "ok": true }` |

### Tags

| Method | Endpoint | Description | Body | Response |
|--------|----------|-------------|------|----------|
| GET | `/api/tags` | List all tags (read-only) | - | `200 { "ok": true, "tags": [ "name" ] }` |
| POST | `/api/tags` | Add new tag (name only) | `{ "name": "..." }` | `201 { "ok": true, "tag": "..." }` |

### Error Responses

All errors follow the same pattern: `200 { "ok": false, "error": "message" }` (or `401`, `403`, `404`, `500` where appropriate).

## Security Considerations

- All endpoints except `/api/auth/*` and `/api/status` require valid JWT token.
- Tokens expire after 24 hours.
- Rate limiting is not implemented; consider adding if exposed publicly.
- Input validation is performed server-side for all fields.