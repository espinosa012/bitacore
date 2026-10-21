# Proposal

## Why

vg-task-manager is frequently used to coordinate and track software development work following the OpenSpec specification-driven methodology, as evidenced by its existing task-level `openspec-id` tracking. However, tasks representing OpenSpec changes currently have to be categorized under generic types such as `task` or `feature`. This prevents teams from immediately distinguishing OpenSpec change proposals, RFCs, and specification workflows from routine bug fixes and features on Kanban boards, filters, and project summaries. Introducing a first-class "OpenSpec Change" task type provides dedicated visual identity and classification for spec-driven workflows.

## What Changes

- **Add "OpenSpec Change" Task Type Definition**:
  - Define `openspec-change` (Display Name: "OpenSpec Change") with icon `code branch` and color `purple`.
  - Add canonical mappings for `openspec-change`, `openspec_change`, `openspec`, and `change` in `js/constants.js`.
- **Default Task Types and Project Seeding**:
  - Include `openspec-change` in `DEFAULT_TASK_TYPES` across backend (`server.js`) and client (`js/mongo-sync.js`, `js/constants.js`).
  - Update project seeding and task type initialization so new projects and projects verifying defaults include `openspec-change`.
  - Add fallback `<option value="openspec-change">OpenSpec Change</option>` to all task type select elements in `index.html` (`#typeFilter`, `#newTaskType`, `#editTaskType`, `#pageTaskType`, `#newPageSubtaskType`, `#newSubtaskType`).
- **UI Integration**:
  - Kanban cards render the `openspec-change` badge with the purple `code branch` icon.
  - Type filter in board header includes "OpenSpec Change".
  - Admin panel task types tab displays and manages `openspec-change` alongside existing standard types.

## Capabilities

### Modified Capabilities
- `api`: Extend Task Type Management to include `openspec-change` in the default registered task types returned by `/api/task-types`.
- `projects`: Update default task types requirement and project seeding so projects initialize with `openspec-change`.

## Impact

- **Backend (`server.js`)**:
  - Update `DEFAULT_TASK_TYPES` array to include `{ id: 'openspec-change', name: 'OpenSpec Change', icon: 'code branch', color: 'purple' }`.
  - Ensure seeding helper inserts default types idempotently so existing projects also obtain the `openspec-change` type if missing.
- **Frontend Core (`js/constants.js`, `js/mongo-sync.js`)**:
  - Update `TASK_TYPES` and `TASK_TYPE_MAPPINGS` in `js/constants.js`.
  - Update `DEFAULT_TASK_TYPES` in `js/mongo-sync.js`.
- **Frontend Markup (`index.html`)**:
  - Add option `<option value="openspec-change">OpenSpec Change</option>` to HTML type dropdowns for initial serverless/offline fallback.
