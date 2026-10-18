# Proposal

## Why

vg-task-manager currently treats all tasks as uniform entities and does not support parent-child relationships between tasks. As project complexity grows, users need to categorize work by type (`task`, `bug`, `analysis`, `feature`) and decompose larger units of work into subtasks without losing track of their hierarchy or progress.

## What Changes

- **Task Types**:
  - Introduce a database collection (`task_types`) in MongoDB storing predefined task types: `task` (blue), `bug` (red), `analysis` (teal), and `feature` (green).
  - Add a `type` field to the task schema (defaulting to `task` for existing and untyped tasks).
  - Add a task type filter in the Kanban board header alongside existing filters.
  - Render task type badges with icons and colors on Kanban cards, creation/edit modals, and the standalone task page.

- **Task Hierarchy & Subtasks**:
  - Add a `parentId` field (`string | null`) to the task schema to support strict multi-level tree hierarchies.
  - Enforce validation rules: a task cannot be its own subtask, cannot have its parent or ancestors as subtasks (no cycles), cannot have its siblings as subtasks, and can have at most one parent.
  - Add a Subtasks section in the task detail views (edit modal and task page) with:
    - Agile inline quick-creation (title + type picker + add on Enter, Jira style).
    - Existing task search-and-link picker that filters out invalid targets (self, parent/ancestors, siblings, and already-assigned subtasks).
    - Subtasks list with status, type, and unlinking option.
    - Parent task banner/badge navigating or opening the parent task.
  - Display a parent task badge on subtask Kanban cards that opens the parent task modal when clicked.
  - Display a subtask progress indicator (e.g. `2/3 subtasks`) on parent Kanban cards.
  - Implement cascade deletion: deleting a parent task deletes all its direct and indirect subtasks and attachments, with a confirmation warning showing the total number of subtasks that will be deleted.

## Capabilities

### Modified Capabilities
- `api`: Extend Task Management requirements to include `type` and `parentId` fields, filtering by task type, task types listing, and recursive cascade deletion of subtasks.

## Impact

- **Backend / Database (`server.js`)**:
  - MongoDB connection initializes/seeds `task_types` if missing.
  - `GET /api/task-types` endpoint to retrieve available types.
  - `GET /api/tasks` updated to support `type` and `parentId` query filters.
  - `POST /api/tasks` and `PUT /api/tasks` validation for `type` and `parentId`.
  - `DELETE /api/tasks/:id` updated to recursively delete subtasks and their attachments.
- **Frontend Core (`js/constants.js`, `js/validation.js`, `js/app.js`)**:
  - Add default task type constants, icons, and colors.
  - Update task JSON schema validation and normalization.
  - Manage task types list and hierarchy relationships in app state.
- **UI & Modals (`index.html`, `js/modals.js`, `js/board.js`, `js/task-page.js`)**:
  - Header type filter dropdown.
  - Kanban cards: type badge, parent badge with modal open trigger, and subtask progress indicator.
  - Create/edit modal & task page: type selector, parent task banner, subtasks tab with quick-add and existing-task search.
  - Delete confirmation dialog showing subtasks deletion warning count.
