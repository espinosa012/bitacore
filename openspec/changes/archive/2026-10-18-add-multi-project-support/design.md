# Design

## Context

See `proposal.md` for problem background and motivation.

Currently, `vg-task-manager` uses a hardcoded database name (`vg-task-manager`) both in the Node.js backend (`server.js`) and in the client-side synchronization layer (`js/mongo-sync.js`). Task types are seeded once globally into `task_types` in `vg-task-manager`, and tasks/attachments share a single collection.

To support multiple isolated projects while maintaining database-driven configuration without an admin UI, we introduce a dual-layer data architecture: a central database for global entities (`users`, `projects`) and isolated project databases for workspace data (`tasks`, `tags`, `attachments`, `task_types`).

## Goals / Non-Goals

**Goals:**
- Provide full data isolation per project via distinct MongoDB databases.
- Store project membership on user documents (`user.projects: [projectId, ...]`).
- Store project definitions in a central `projects` collection in `vg-task-manager`.
- Retain existing tasks seamlessly under a default project named `project-ludum` pointing to `vg-task-manager`.
- Allow each project to configure its own custom task types in its own database.
- Provide a responsive project selector in the application header to switch active projects.
- Support project scoping and membership authorization in the REST API (`X-Project-Id`).

**Non-Goals:**
- Implementing an admin UI for creating projects, deleting projects, or editing user memberships (all configured directly in MongoDB).
- Cross-project task aggregation, dependencies, or transfers.
- Granular per-project role-based permissions (membership grants read/write access to that project).

## Decisions

### 1. Database-Per-Project Isolation
- **Choice**: Each project has its own dedicated MongoDB database name specified in `projects.dbName`.
- **Rationale**: User specified that each project must have its own task database. In MongoDB, a single cluster connection can switch databases dynamically using `client.db(dbName)` without overhead.
- **Alternatives Considered**: Multi-tenancy via `projectId` field in single collections. Rejected because it does not provide true database isolation and complicates per-project task types and GridFS attachments.

### 2. User-Centric Membership (`user.projects`)
- **Choice**: The `users` collection contains an array of project IDs: `projects: ["project-ludum", "proj2"]`.
- **Rationale**: When a user authenticates, their profile payload already contains the list of projects they can access, simplifying client-side checks and session management.
- **Alternatives Considered**: `projects.members: ["username"]`. Rejected per user decision.

### 3. Central `projects` Collection Schema
- **Choice**: Define projects in `projects` collection in the central `vg-task-manager` database:
  ```json
  {
    "_id": "project-ludum",
    "id": "project-ludum",
    "name": "Project Ludum",
    "dbName": "vg-task-manager",
    "description": "Default primary project",
    "createdAt": "2026-10-18T20:00:00Z"
  }
  ```
- **Rationale**: Decouples the project display name and ID from the physical MongoDB database name, allowing custom naming and backwards compatibility with existing databases.

### 4. Per-Project Task Types
- **Choice**: Each project database contains its own `task_types` collection.
- **Rationale**: Allows projects to have completely independent task classifications, colors, and icons.
- **Fallback**: When switching to a project whose `task_types` collection is empty, the system automatically seeds the default set (`task`, `bug`, `analysis`, `feature`).

### 5. Header Project Selector & UI Integration
- **Choice**: A `<select id="projectSelector">` is placed in the navigation header `<header class="app-header">` between the brand and search input.
- **State Management**:
  - Selected project is persisted in `localStorage` under `vg_active_project`.
  - On switch: active database is updated via `MongoSync.setCurrentDb(project.dbName)`, task types are refreshed in `VG.Constants.TASK_TYPES`, dropdowns are rebuilt, and `loadFromMongo()` refreshes tasks and tags.

### 6. REST API Project Context & Authorization
- **Choice**: API requests specify project context via `X-Project-Id` header (or `?projectId=...`).
- **Authorization**: The auth middleware extracts the project ID, looks up the project in `projects`, verifies `req.user.projects.includes(projectId)`, and sets `req.project = projectDoc`.
- **Defaulting**: If `X-Project-Id` is omitted, requests default to the first project in `req.user.projects` (or `project-ludum`).

## Risks / Trade-offs

- **[Risk] User has no projects configured**:
  - *Mitigation*: The UI displays an empty state banner informing the user that their account has not been assigned to any project, hiding the Kanban board.
- **[Risk] Stored active project is revoked or deleted**:
  - *Mitigation*: On startup or login, if `vg_active_project` does not match any project in the user's current `projects` list, fallback to `user.projects[0]`.
- **[Risk] Per-project task types breaking existing board rendering**:
  - *Mitigation*: Ensure `canonicalTaskType` helper in `js/constants.js` and badge rendering fall back safely to `'task'` styling if an unknown type is encountered.

## Migration Plan

1. **Initial Seed**:
   - In `server.js` startup or upon first DB connection, check if `projects` collection in `vg-task-manager` has `project-ludum`. If not, insert it with `dbName: "vg-task-manager"`.
   - Update existing user documents lacking `projects` to set `projects: ["project-ludum"]`.
2. **Rollback Strategy**:
   - If issues arise, pointing the client default database back to `vg-task-manager` restores original single-database operation without data loss.
