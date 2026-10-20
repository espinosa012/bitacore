# Tasks

## 1. Backend Authentication, Roles & Endpoints

- [x] 1.1 Update `auth.js` to encode and verify `isAdmin: Boolean` in JWT tokens, and export an `isAdminUser(req)` validation helper; verify token generation and decoding in unit test
- [x] 1.2 Update `server.js` to implement `/api/auth/bootstrap` (active only when `users` count is 0) to register the initial administrator, and restrict `/api/auth/register` to administrative callers; verify via curl requests
- [x] 1.3 Implement `/api/admin/users` in `server.js` for listing all users, creating users with assigned projects, and updating project assignments or deleting users; verify using API calls with admin and non-admin tokens
- [x] 1.4 Implement `/api/admin/projects` in `server.js` to create projects with automatic seeding of `task_types` and empty tag registries in the target project database; verify new project database creation
- [x] 1.5 Implement task type and tag cascade endpoints in `server.js` (`DELETE /api/projects/:projectId/task-types/:typeId` reassigning tasks to `task`, and tag PUT/DELETE updating all tasks in the project); verify task updates in MongoDB

## 2. Client Authentication & Data Layer

- [x] 2.1 Update `js/auth.js` to store `isAdmin` status, remove public `register()` calls, implement `bootstrapAdmin()`, and grant global access to all projects when `isAdmin` is true; verify session storage and project lists
- [x] 2.2 Update `js/mongo-sync.js` with admin actions for user creation, project creation, task type mutations with automatic task reassignment to `task`, and atomic tag cascading updates (`updateMany` with `arrayFilters` and `$pull`); verify methods against project collections
- [x] 2.3 Update project selector population and access checks in `js/app.js` and `js/auth.js` so administrators automatically see and access all available projects without explicit membership; verify project switching for admin accounts

## 3. User Interface & Admin Panel

- [x] 3.1 Update `index.html` to remove registration tabs and prompts from `modalAuthOverlay`, and add an Initial Administrator Bootstrap form modal; verify bootstrap form triggers only when no users exist
- [x] 3.2 Add `<section class="admin-view" id="adminView" hidden>` in `index.html` and styles in `css/app.css` featuring navigation tabs for Users, Projects, Task Types, and Tags; verify responsive layout and tab markup
- [x] 3.3 Add header toggle controls in `index.html` and view switching logic in `js/app.js` directing admins to the Admin Panel upon login with smooth switching to the Kanban Board; verify view state transitions
- [x] 3.4 Implement Users management tab in Admin Panel (listing registered accounts, modal to create new user with project checkboxes, and project assignment editor); verify creating a user and logging in with assigned permissions
- [x] 3.5 Implement Projects management tab in Admin Panel (listing existing projects, form to create new project with ID, display name, description, and database name); verify new project creation and selector update
- [x] 3.6 Implement Task Types tab in Admin Panel (project selector dropdown, table of types with icons and colors, creation/edit modal, and deletion triggering task reassignment to `task`); verify task cards reflect reassignment
- [x] 3.7 Implement Tags tab in Admin Panel (project selector dropdown, list of tags with usage counters, tag rename modal cascading to all tasks, and delete action removing tag from registry and tasks); verify task documents update in real time

## 4. End-to-End Verification

- [x] 4.1 Perform end-to-end verification of the administrator workflow: initial bootstrap -> create project -> create user -> edit task types and tags -> log in as regular user -> verify data isolation and standard Kanban board functionality
