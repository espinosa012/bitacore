# Proposal

## Why

Currently, any user can self-register publicly and access default projects, while project management, user assignment, task type customization, and tag maintenance lack an administrative user interface. This change introduces a dedicated global Administrator Panel, disables public self-registration (in favor of a first-run setup and admin-managed user accounts), and enables granular project administration including user-to-project assignment, project creation, per-project task types editing, and per-project tag lifecycle management with cascade updates.

## What Changes

- **Global Administrator Role**: Introduce an `isAdmin: true` flag on user accounts. An authenticated administrator lands directly on the Admin Panel and gains global visibility into all projects without requiring manual per-project assignment. A header toggle allows seamlessly switching between the Admin Panel and the Kanban Board.
- **Eliminate Public Registration & First-Run Bootstrap**: Remove public self-registration tabs, links, and public registration endpoints. When the database has zero registered users, the system presents a one-time "Initial Administrator Setup" form. Once created, public registration is permanently disabled.
- **User & Project Assignment Management**: Administrators can list, create, edit, and delete users from the Admin Panel, including setting credentials and assigning/unassigning users to specific projects.
- **Project Creation & Configuration**: Administrators can create new projects (specifying ID, display name, database name, and description). Newly created projects are seeded with default task types (`task`, `bug`, `analysis`, `feature`) and an empty tag registry.
- **Project Task Types Management**: Administrators can customize task types per project (create, rename, update icon/color, delete). When a task type is deleted, all existing tasks using that type in the project are automatically reassigned to the default `task` type.
- **Project Tags Management**: Administrators can manage tags per project. Renaming a tag cascades the new name to all tasks in that project. Deleting a tag removes it from the project registry and pulls it from all tasks in that project.

## Capabilities

### New Capabilities
- `admin-panel`: Provides administrative views and actions for global administrators to manage users, projects, task types, and tags.

### Modified Capabilities
- `api`: Updates authentication requirements to eliminate public self-registration in favor of initial admin bootstrap and admin-authorized user creation; adds admin-authorized endpoints for managing task types, tags, projects, and users.
- `projects`: Grants global administrators automatic access to all projects and supports project creation with seeded task types and tag registry.

## Impact

- **Frontend**:
  - `index.html`: Remove registration tab/prompt from `modalAuthOverlay`; add initial administrator setup view/modal; add `<section class="admin-view" id="adminView">` with navigation tabs for Users, Projects, Task Types, and Tags; add Admin/Kanban switcher in the header.
  - `js/auth.js`: Update login handling to direct admins to the admin panel; remove public `register()` function; add first-run admin registration; support `isAdmin` state.
  - `js/app.js`: Handle admin view toggling, routing, and header state for admin sessions.
  - `js/mongo-sync.js`: Add helper operations for project creation, task type mutations, tag cascading mutations, and user administration.
- **Backend**:
  - `server.js`: Remove public `/api/auth/register`; add bootstrap check endpoint; add `/api/admin/*` routes or enforce admin checks on user creation, project creation, task type updates, and tag cascades.
  - `auth.js`: Include `isAdmin` in JWT tokens and verify admin privileges for administrative endpoints.
- **Data Model**:
  - `users` collection: add `isAdmin: Boolean`.
  - `projects` collection: admin global access bypasses membership filter.
