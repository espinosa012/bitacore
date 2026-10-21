# Tasks

## 1. Constants & Core Data Models

- [x] 1.1 Update `TASK_TYPES` and `TASK_TYPE_MAPPINGS` in `js/constants.js` to define `openspec-change` (label: "OpenSpec Change", icon: "code branch", color: "purple") along with aliases (`openspec-change`, `openspec_change`, `openspec`, `change`), and verify via evaluation that `canonicalTaskType('openspec-change')` and its aliases resolve correctly to `openspec-change`
- [x] 1.2 Update `DEFAULT_TASK_TYPES` in `js/mongo-sync.js` to include `{ id: 'openspec-change', name: 'OpenSpec Change', icon: 'code branch', color: 'purple' }`, and verify fallback list returns the 5 default types

## 2. Backend Persistence & Seeding

- [x] 2.1 Update `DEFAULT_TASK_TYPES` in `server.js` to include `{ id: 'openspec-change', name: 'OpenSpec Change', icon: 'code branch', color: 'purple' }`
- [x] 2.2 Update `ensureProjectTaskTypes(db, projectId)` in `server.js` to iterate through all `DEFAULT_TASK_TYPES` and upsert missing defaults with `$setOnInsert` for each registered project, ensuring existing and new projects obtain `openspec-change` idempotently

## 3. UI Markup & Templates

- [x] 3.1 Update static dropdown `<select>` options in `index.html` (`#typeFilter`, `#newTaskType`, `#editTaskType`, `#pageTaskType`, `#newPageSubtaskType`, `#newSubtaskType`) to include `<option value="openspec-change">OpenSpec Change</option>`, verifying markup integrity

## 4. Integration Verification

- [x] 4.1 Perform end-to-end verification of task lifecycle with type `openspec-change`: create and update a task with type `OpenSpec Change`, verify Kanban card purple `code branch` badge rendering, check filter dropdown behavior, and verify task persistence via API
