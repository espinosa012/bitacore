# Design

## Context

vg-task-manager is a minimalist Kanban board backed by a Node.js server (`server.js`) connected to MongoDB Atlas (`vg-task-manager` database). Tasks, tags, users, and attachments are stored in separate MongoDB collections and synchronized to the browser client. The client renders the UI using vanilla JavaScript and Fomantic-UI.

See `proposal.md` for motivation and high-level feature requirements.

## Goals / Non-Goals

**Goals:**
- Provide a `task_types` collection in MongoDB with initial types (`task`, `bug`, `analysis`, `feature`).
- Introduce `type` (string, default `task`) and `parentId` (string or null, default `null`) to the task model.
- Prevent circular references, self-parenting, and sibling subtasking.
- Add an agile Jira-style inline subtask creation control and an existing-task search picker inside the task edit modal and task page.
- Render clickable parent badges on subtask Kanban cards, progress badges on parent cards, and a type filter on the board header.
- Execute recursive cascade deletion of subtasks and attachments with an explicit count confirmation warning.

**Non-Goals:**
- In-UI CRUD management of task types (types are pre-seeded in the database; UI configuration is deferred).
- Multiple parents per task (the hierarchy is a strict forest of trees; each task has at most one parent).
- Drag-and-drop nesting directly inside Kanban columns (subtasks move across columns independently by their status).

## Decisions

### 1. Pointer-Based Hierarchy (`parentId`) vs Embedded Subtasks
- **Choice**: Store `parentId: string | null` on each task document.
- **Rationale**:
  - Treats subtasks as first-class tasks: they can have their own status, priority, assignee, comments, and attachments.
  - Supports multi-level nesting (subtasks of subtasks) naturally without schema nesting depth limits.
  - Prevents MongoDB document 16 MB limit issues and simplifies pagination/filtering.
- **Alternatives Considered**:
  - *Embedded subtasks array*: Breaks when subtasks have attachments or multi-level hierarchies; complicates column-based Kanban queries.
  - *Array of child IDs (`subtaskIds: []`) on parent*: Risk of desynchronization between parent and child on concurrent edits or deletions. `parentId` serves as a single source of truth.

### 2. Task Types Collection & Default Seeding
- **Choice**: A dedicated `task_types` collection in MongoDB.
  - Documents:
    - `{ _id: 'task', name: 'Task', icon: 'check square outline', color: 'blue' }`
    - `{ _id: 'bug', name: 'Bug', icon: 'bug', color: 'red' }`
    - `{ _id: 'analysis', name: 'Analysis', icon: 'search', color: 'teal' }`
    - `{ _id: 'feature', name: 'Feature', icon: 'star', color: 'green' }`
  - On server start / DB connect, seed missing default types.
  - Serve via `GET /api/task-types`.
- **Rationale**: Keeps configuration dynamic in the database rather than hardcoded in the frontend, laying the foundation for future admin customization.
- **Alternatives Considered**:
  - *Hardcoding types solely in client constants*: Would not fulfill the requirement of storing configuration in database tables/collections.

### 3. Hierarchy Validation and Eligible Subtask Filtering
- **Choice**:
  - Validation algorithm:
    1. `candidateId !== taskId` (no self-reference).
    2. Traverse parent ancestry of `candidateParentId`: if `taskId` is found, reject (cycle prevention).
    3. If `task.parentId !== null` and `task.parentId === candidate.parentId`, reject (prevent sibling subordination).
    4. `candidate.parentId === null` when linking existing task (a subtask cannot be stolen from another parent without first unlinking).
  - Search picker in UI applies this filter in real-time, only offering valid tasks for linking.
- **Rationale**: Guarantees tree invariants and prevents broken or circular graphs.

### 4. Agile Inline Creation (Jira-style)
- **Choice**: In the task edit modal and task page, the "Subtasks" tab provides an inline form:
  `[ Input: Title ] [ Select: Type ] [ Button: Add ]`.
  Pressing Enter or clicking Add creates a new task object with `parentId = currentTaskId`, status `planned`, priority `medium`, and type set to selected (default `task`), then saves and updates the subtasks list immediately.
- **Rationale**: Minimizes friction, allowing rapid task breakdown without closing modals or navigating away.

### 5. Parent Navigation from Kanban Cards
- **Choice**: Subtask cards on the Kanban board display `[ ↳ #parentId: Parent Title ]`. Clicking this badge calls `event.stopPropagation()` and triggers `openEditModal(parentTask)`.
- **Rationale**: Allows rapid upward navigation through the hierarchy without accidentally triggering edit of the subtask card itself.

### 6. Cascade Deletion with Recursive Count Warning
- **Choice**:
  - Before deletion, traverse children recursively to calculate `descendantsCount`.
  - If `descendantsCount > 0`, format the warning:
    *"Are you sure you want to delete this task? It has {N} subtask(s) that will also be permanently deleted along with their attachments."*
  - Deletion handler gathers all descendant IDs and issues bulk delete for `tasks` and `attachments`.
- **Rationale**: Prevents orphaned subtasks in the database and ensures full transparency for the user before destructive operations.

## Risks / Trade-offs

- **[Risk] Accidental deletion of large subtask trees**:
  → *Mitigation*: Dangerous action UI styling (red button) and explicit count in confirmation modal.
- **[Risk] Legacy / existing tasks without `type` or `parentId`**:
  → *Mitigation*: Schema normalization in `validation.js` defaults `type` to `'task'` and `parentId` to `null`.
- **[Risk] UI clutter on small Kanban cards**:
  → *Mitigation*: Compact mini-badges for parent reference and subtask counts, with clear tooltips and icons.
