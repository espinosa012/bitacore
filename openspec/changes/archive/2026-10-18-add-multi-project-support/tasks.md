# Tasks

## 1. Data Model, Seeding & Migration

- [x] 1.1 Implement project registry seeding in `server.js` ensuring `project-ludum` (pointing to `vg-task-manager`) exists in the `projects` collection on database connection, and verify startup logs confirm initialization.
- [x] 1.2 Update user registration and user retrieval in `server.js` and `auth.js` to include the `projects` array (`["project-ludum"]` by default for new users), ensuring existing users without `projects` default to `["project-ludum"]`.
- [x] 1.3 Implement project-specific `task_types` initialization helper in `server.js` that seeds default types (`task`, `bug`, `analysis`, `feature`) into a project database if its `task_types` collection is empty.

## 2. REST API Multi-Project Support

- [x] 2.1 Implement `GET /api/projects` endpoint in `server.js` returning the list of projects authorized for the authenticated user (`req.user.projects`), and verify with authenticated curl request.
- [x] 2.2 Implement project context resolution middleware in `server.js` that parses `X-Project-Id` (or `?projectId`), validates that `req.user.projects` includes the requested project ID, and attaches `req.projectDb = client.db(project.dbName)` (falling back to first user project if unspecified).
- [x] 2.3 Update `/api/tasks`, `/api/tags`, and `/api/task-types` endpoints to query and mutate `req.projectDb` rather than the static `DB_NAME`, and verify operations are isolated to the target project database.
- [x] 2.4 Add authorization error handling returning HTTP 403 when an authenticated user attempts to access a project ID not present in their `projects` array, and verify with a test request.

## 3. Frontend Multi-Project Client & State

- [x] 3.1 Update `js/auth.js` to store and expose `user.projects` from login/session data and provide a helper `getUserProjects()`.
- [x] 3.2 Update `js/mongo-sync.js` to support querying project metadata from the central database, dynamic updating of `currentDb`, and fetching task types for the active project.
- [x] 3.3 Update `js/constants.js` with a helper `updateTaskTypes(typesArray)` to dynamically replace `TASK_TYPES` and update type mappings when a project is loaded.
- [x] 3.4 Add an empty state segment in `index.html` and logic in `js/app.js` to notify users who have no projects assigned (`projects: []`).

## 4. UI Header Selector & Dynamic Task Types

- [x] 4.1 Add project selector dropdown element (`#projectSelector`) inside the application header in `index.html` styled with Fomantic-UI.
- [x] 4.2 Implement project selector population and event listener in `js/app.js` to store the active project in `localStorage` (`vg_active_project`), switch `currentDb`, and trigger board reload.
- [x] 4.3 Implement dynamic rebuilding of task type dropdowns (`#typeFilter`, `#newTaskType`, `#editTaskType`, `#pageTaskType`, `#newPageSubtaskType`) upon switching projects.
- [x] 4.4 Verify card rendering, column display, and type badges on the Kanban board accurately reflect the active project's task types.

## 5. End-to-End Verification

- [x] 5.1 Test switching between `project-ludum` and a secondary configured project, verifying that tasks, tags, attachments, and task types remain strictly isolated in their respective databases.
- [x] 5.2 Test user authorization boundaries by verifying that users only see their assigned projects in the selector and receive 403 on API requests targeting unauthorized projects.
