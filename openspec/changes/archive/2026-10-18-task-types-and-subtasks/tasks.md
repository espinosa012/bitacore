# Tasks

## 1. Database Model and Server Endpoints

- [x] 1.1 Seed default task types (`task`, `bug`, `analysis`, `feature`) into MongoDB collection `task_types` upon connection in `server.js`, and verify startup logs show the seeded collection count.
- [x] 1.2 Implement `GET /api/task-types` in `server.js` with authentication support, and verify via curl/HTTP request that it returns the 4 configured task types.
- [x] 1.3 Update `GET /api/tasks`, `POST /api/tasks`, and `PUT /api/tasks` in `server.js` to accept `type` and `parentId` fields and filters, and verify creating and fetching tasks with `type` and `parentId`.
- [x] 1.4 Update `DELETE /api/tasks/:id` in `server.js` to gather all recursive descendant task IDs and delete all of them together with their attachments, and verify deleting a parent removes all descendant tasks and attachments.

## 2. Frontend Core: Constants, Normalization, and Hierarchy Utilities

- [x] 2.1 Define `TASK_TYPES` and helper `canonicalTaskType` in `js/constants.js` with icons and colors, and verify constants export in browser environment.
- [x] 2.2 Update `js/validation.js` to validate and normalize `type` (fallback `'task'`) and `parentId` (fallback `null`), and verify validation passes for both legacy task objects and new typed tasks.
- [x] 2.3 Implement hierarchy helper functions (detect cycles, get ancestors, get siblings, and filter eligible subtasks) in `js/app.js` or `js/constants.js`, and verify unit scenarios (self-reference rejected, cycle rejected, sibling rejected).

## 3. UI: Modals and Task Detail View (Quick Add & Linking)

- [x] 3.1 Add task type dropdown to task creation modal, edit modal (`index.html` and `js/modals.js`), and task page (`js/task-page.js`), and verify selected type persists on save.
- [x] 3.2 Add parent task banner to the edit modal and task page that displays parent ID, title, and status with click-to-open navigation, and verify clicking opens the parent task.
- [x] 3.3 Implement agile inline subtask quick-creation (title input, type dropdown, Enter/Add button) in the Subtasks tab of `js/modals.js` and `js/task-page.js`, and verify entering a title immediately creates and displays the subtask.
- [x] 3.4 Implement existing-task search picker in the Subtasks tab applying hierarchy filter rules, and verify linking an eligible task and unlinking a subtask.

## 4. UI: Kanban Board Badges, Progress, and Filter

- [x] 4.1 Add task type filter dropdown (`#typeFilter`) in `index.html` and integrate it into `js/board.js` filtering logic, and verify filtering cards by task type.
- [x] 4.2 Render task type badge and parent task badge on Kanban cards in `js/board.js`, and verify clicking the parent badge opens the parent modal without triggering the card's click event.
- [x] 4.3 Add subtask progress indicator (e.g. `2/3 subtasks`) on parent Kanban cards in `js/board.js`, and verify it accurately reflects completed versus total direct subtasks.

## 5. UI: Cascade Deletion Warning and End-to-End Verification

- [x] 5.1 Update task deletion confirmation in `js/modals.js` and `js/board.js` to compute total recursive subtasks and display a warning message with the subtask count, and verify the modal displays the exact count.
- [x] 5.2 Perform end-to-end manual verification across all new capabilities (creating typed tasks, multi-level hierarchy, inline subtask addition, board filtering, and cascade deletion), and verify board state and MongoDB persist consistently.
