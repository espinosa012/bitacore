# Proposal

## Why

Currently, `vg-task-manager` operates against a single monolithic database (`vg-task-manager`), causing all tasks, tags, attachments, and task types to be shared globally. Teams and users need to manage distinct projects with isolated task databases, custom task types per project, and user-level project access control without requiring a complex administration UI.

## What Changes

- **Multi-project Data Isolation**: Each project is assigned its own dedicated MongoDB database for its tasks, tags, attachments, and project-specific task types.
- **Central Project Registry & User Membership**: Projects are defined in a central `projects` collection in the primary database (`vg-task-manager`). Users belong to one or more projects via a `projects: [projectId, ...]` array on their user document.
- **Default Existing Project**: The current tasks in `vg-task-manager` are preserved under a default project named `project-ludum` ("Project Ludum").
- **Header Project Selector**: A project dropdown selector is added to the application header allowing users to switch between their authorized projects.
- **Dynamic Per-Project Task Types**: When switching projects, the UI and API dynamically load that project's specific `task_types` collection from its database.
- **REST API Multi-Project Support**: API endpoints accept project context via an `X-Project-Id` header (or `?projectId` query parameter) and validate user membership before accessing the corresponding project database.
- **List Projects Endpoint**: Authenticated endpoint `GET /api/projects` returns the list of projects accessible to the requesting user.

## Capabilities

### New Capabilities
- `projects`: Multi-project management, database isolation per project, user membership verification, header project selector, and per-project task types.

### Modified Capabilities
- `api`: Project scoping via `X-Project-Id`, project membership validation on protected endpoints, and new `GET /api/projects` endpoint.

## Impact

- **Database**: Primary database (`vg-task-manager`) stores `users` (with `projects` array) and `projects` collection. Each project's database stores `tasks`, `tags`, `attachments`, and `task_types`.
- **Frontend**: `js/mongo-sync.js` updates active database dynamically; `js/app.js` and `js/auth.js` manage active project selection and populate UI selectors; `index.html` adds the project selector in the header.
- **Backend API**: `server.js` resolves active project database per request and enforces user membership checks.
