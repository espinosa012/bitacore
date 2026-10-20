# Tasks

## 1. Data Model and Backend Validation

- [x] 1.1 Update `js/validation.js` to validate and normalize `linkedTaskIds: string[]` (ensuring array of string IDs, deduplicating with a Set, defaulting to `[]`) and verify with valid and invalid task JSON payloads.
- [x] 1.2 Update `server.js` endpoints (`GET /api/tasks`, `GET /api/tasks/{id}`, `PUT /api/tasks/{id}`) to include, preserve, and serialize `linkedTaskIds`.
- [x] 1.3 Update `server.js` `DELETE /api/tasks/{id}` to pull the deleted task ID from all other tasks' `linkedTaskIds` in the MongoDB collection and verify deletion does not delete linked tasks.

## 2. Core Linking Logic

- [x] 2.1 Add `linkTasks(taskId1, taskId2, allTasks)` and `unlinkTasks(taskId1, taskId2, allTasks)` helper methods in `js/constants.js` that perform bidirectional updates and enforce self-link / duplicate prevention.
- [x] 2.2 Update task deletion routines in `js/modals.js` and `js/task-page.js` to strip the deleted task ID from all other tasks' `linkedTaskIds` prior to invoking `persistChanges`.

## 3. UI Implementation (Modal & Task Page)

- [x] 3.1 Add HTML markup for the visible "Tareas Enlazadas" block in `index.html` in both the task edit modal and the dedicated task page above the tab segments.
- [x] 3.2 Implement linked tasks rendering, task selector population, "Enlazar tarea" button click handler, and unlinking in `js/modals.js`.
- [x] 3.3 Implement linked tasks rendering, task selector population, "Enlazar tarea" button click handler, and unlinking in `js/task-page.js`.
- [x] 3.4 Rename subtask UI labels in `index.html`, `js/modals.js`, and `js/task-page.js` from "Link Existing Task as Subtask" to "Asignar tarea existente como subtarea".

## 4. Board Indicator and Verification

- [x] 4.1 Update `js/board.js` card rendering to show a linked tasks counter badge (`<i class="linkify icon"></i> N`) in the card footer metadata when a task has linked tasks.
- [x] 4.2 Verify end-to-end functionality: create bidirectional links between tasks, verify both tasks show the link, verify board card badge, verify opening linked task, verify unlinking, and verify link cleanup upon task deletion.
