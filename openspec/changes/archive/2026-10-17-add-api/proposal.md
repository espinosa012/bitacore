# Proposal

## Why

vg-task-manager's web UI communicates with MongoDB Atlas through vg-mongo-proxy, but a Node REST API already exists in `server.js` that talks directly to MongoDB. The UI never calls those routes. Exposing the data layer through a REST API lets external clients, scripts, and mobile apps act on the same task data the web UI already manages.

## What Changes

- **Add JWT-based authentication to server.js** so protected endpoints verify `Authorization: Bearer <token>` on every request. Registration and login return access tokens; every other endpoint requires a valid token.
- **Expose task CRUD over REST**: list, create, read one, update (with status change history), delete. Task attachments are managed as part of a task's attachment array (upload via `POST /api/tasks/{id}/attachments`, list, delete individual files), matching the web UI's attachment model.
- **Expose user listing** (`GET /api/users`) so assignee dropdowns populate from authenticated clients, not just the web browser.
- **Expose tag registry updates** so clients can manage the shared tag set.
- Document the OpenAPI 3.0 specification for client consumption.
- No changes to vg-mongo-proxy or MongoDB connection strings — direct access is unchanged.
- No changes to the web UI code — the frontend already mirrors all needed operations.

## Capabilities

### New Capabilities

- `api`: A REST API layer exposing task management, comments, attachments, and auth to any HTTP client, with JWT authentication.

## Impact

- Adds `jsonwebtoken` as a dependency to `package.json`.
- Wraps existing `connectMongo`/route handlers with an auth middleware.
- Adds static JWT secret (env-overridable) used by sign and verify functions.
