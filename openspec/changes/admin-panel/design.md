# Design

## Context

The application currently supports user authentication with PBKDF2/scrypt hashed passwords in a shared `users` collection in MongoDB, while tasks, attachments, task types, and tag registries are isolated across individual project databases. Dual execution is supported: direct server REST endpoints in `server.js` and direct client proxy queries via `vg-mongo-proxy` (`MongoSync.action`).

Currently:
- Self-registration is open to anyone via `/api/auth/register` and the registration tab in `modalAuthOverlay`.
- User project access is strictly controlled by matching `userDoc.projects`.
- There is no UI to configure project task types, create new projects, manage tag registries, or assign users to projects.

See `proposal.md` for motivation and high-level requirements.

## Goals / Non-Goals

**Goals:**
- Provide a responsive, multi-tab Admin Panel (`adminView`) accessible exclusively by users with `isAdmin: true`.
- Implement a first-run administrator bootstrap flow when zero users exist, permanently disabling public self-registration thereafter.
- Enable administrators to create new projects and manage user-to-project assignments.
- Allow administrators to customize task types per project, automatically reassigning existing tasks to `task` when a type is removed.
- Allow administrators to edit and delete tags per project, cascading renames and deletions across all tasks in that project.
- Provide a navigation toggle in the header allowing administrators to switch between the Admin Panel and the Kanban Board.

**Non-Goals:**
- Complex hierarchical role-based access control (RBAC) beyond admin and standard user.
- Automated migration/transfer of tasks between different projects.
- Self-service password recovery without administrator assistance.

## Decisions

### 1. Initial Administrator Bootstrap & Registration Lockout
- **Decision**: Introduce `/api/auth/bootstrap` (and matching `MongoSync` client logic). When the `users` collection count is 0, the UI displays a dedicated "Initial Administrator Setup" form.
- **Rationale**: Completely removes public self-registration while ensuring a clean setup flow on empty databases without hardcoding default passwords in source control.
- **Alternative considered**: Hardcoded seed user `admin` / `admin123`. Rejected because hardcoded defaults create security risks if left unchanged.

### 2. Global Project Access for Administrators
- **Decision**: Users with `isAdmin: true` automatically bypass the project membership filter in `resolveProjectContext`, `getUserProjects()`, and `fetchProjects()`.
- **Rationale**: An administrator must oversee all projects without needing manual reassignment every time a new project is created.
- **Alternative considered**: Dynamically appending all project IDs to the admin user's `projects` array on every project creation. Rejected because it risks state drift and requires unnecessary database updates across all admin documents.

### 3. Cascading Tag Mutations in Project Database
- **Decision**: Perform tag updates directly against the project's `tasks` and `tags` collections:
  - **Rename**:
    ```javascript
    await projectDb.collection('tasks').updateMany(
      { tags: oldName },
      { $set: { "tags.$[elem]": newName } },
      { arrayFilters: [{ "elem": oldName }] }
    );
    await projectDb.collection('tags').updateOne(
      { _id: 'registry', "tags.name": oldName },
      { $set: { "tags.$.name": newName } }
    );
    ```
  - **Delete**:
    ```javascript
    await projectDb.collection('tasks').updateMany(
      { tags: tagName },
      { $pull: { tags: tagName } }
    );
    await projectDb.collection('tags').updateOne(
      { _id: 'registry' },
      { $pull: { tags: { name: tagName } } }
    );
    ```
- **Rationale**: Guarantees relational consistency between the registry and individual task documents within the project database.

### 4. Task Type Deletion Cascade
- **Decision**: When a task type is deleted from a project, execute:
  ```javascript
  await projectDb.collection('tasks').updateMany(
    { type: deletedTypeId },
    { $set: { type: 'task' } }
  );
  await projectDb.collection('task_types').deleteOne({ _id: deletedTypeId });
  ```
- **Rationale**: Prevents orphaned or unrenderable badge states on cards and filter menus by reverting deleted types to the universally supported base type `task`.

### 5. UI Architecture: Dedicated Admin View Container
- **Decision**: Add `<section class="admin-view" id="adminView" hidden>` to `index.html`. Navigation between views is managed by adding/removing classes and toggling hidden attributes (`main.board-view`, `section.task-page`, `section.admin-view`).
- **Rationale**: Follows the existing view toggle pattern used by `taskPage` without introducing heavy client-side router frameworks.

## Risks / Trade-offs

- **[Risk]** Administrator forgets password and no self-registration exists.
  → **Mitigation**: Add a CLI command or server flag `node server.js --reset-password <username> <new-password>` so system owners with host access can recover accounts.
- **[Risk]** Simultaneous tag rename/deletion on projects with many tasks could cause temporary UI latency.
  → **Mitigation**: Execute operations atomically in MongoDB and display a loading indicator in the Admin Panel during tag cascading operations.
- **[Risk]** Existing databases already in use may have no user with `isAdmin: true`.
  → **Mitigation**: Provide an automatic promotion on server startup if no admin exists, or an environment variable `VG_ADMIN_USERNAME` that elevates a specific username to administrator.
