# Proposal

## Why

Currently, users can only associate tasks using a parent-child subtask hierarchy, which imposes strict structural constraints (single parent, cycle prevention, sibling restrictions, and recursive deletion). In daily project management, tasks often relate to each other across different features, bugs, or hierarchical branches without representing hierarchical sub-components. Providing non-hierarchical, bidirectional task linking enables users to connect related work freely without altering hierarchy or risking cascading deletions.

## What Changes

- Add a `linkedTaskIds: string[]` field to the task data model, defaulting to `[]`.
- Implement bidirectional linking: linking Task A to Task B automatically records Task A in Task B's `linkedTaskIds`, and unlinking from either task removes the reference in both.
- Permit linking without hierarchy restrictions: any task can link to any other task regardless of status, type, or ancestry (only self-linking `A !== B` and duplicate links are rejected).
- Update deletion behavior: deleting a task removes its ID from all other tasks' `linkedTaskIds` without deleting the linked tasks.
- Add an always-visible "Enlazar tarea" / "Linked Tasks" section in the main column (above the tabs) in both the task modal (`js/modals.js`) and the dedicated task page (`js/task-page.js`).
- Clarify existing subtask UI text from "Link Existing Task as Subtask" to "Asignar tarea existente como subtarea" to eliminate confusion with free task linking.
- Add a linked tasks counter badge (`🔗 N`) to Kanban board cards on `js/board.js`.
- Update `js/validation.js`, `server.js`, and data synchronization layers to serialize, validate, and persist `linkedTaskIds`.

## Capabilities

### New Capabilities
- `task-linking`: Non-hierarchical, bidirectional task linking allowing tasks to be freely connected with dedicated UI management and board card badges.

### Modified Capabilities
- `api`: Extend Task Management endpoints (`GET /api/tasks`, `GET /api/tasks/{id}`, `PUT /api/tasks/{id}`, `DELETE /api/tasks/{id}`) to include `linkedTaskIds` and clean up link references on task deletion.

## Impact

- Frontend UI: `index.html`, `js/modals.js`, `js/task-page.js`, `js/board.js`.
- Data validation and schemas: `js/validation.js`.
- Backend & REST API: `server.js` (`/api/tasks` handlers).
- Storage and sync: `js/storage.js`, `js/mongo-sync.js`.
- Backward compatibility: Fully backwards-compatible; missing `linkedTaskIds` defaults to empty array.
