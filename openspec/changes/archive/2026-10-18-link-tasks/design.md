# Design

## Context

See `proposal.md` for motivation and background. The existing system stores tasks in localStorage/IndexedDB on the client and MongoDB via `server.js`. Hierarchy is modeled via `parentId` with strict validation (cycle detection, sibling prevention) and cascading recursive deletes.

## Goals / Non-Goals

**Goals:**
- Provide unrestricted, bidirectional task linking that operates independently of the subtask hierarchy.
- Provide a clean, always-visible UI block in the main column above the tabbed panel for managing linked tasks.
- Keep board cards informed of linked tasks with a counter indicator.
- Maintain data integrity across task deletion, ensuring references are cleaned up without deleting linked tasks.
- Ensure 100% backward compatibility with existing task JSON files and databases.

**Non-Goals:**
- Typed or directed link relationships (e.g. "blocks", "is blocked by", "duplicates"); links are non-directed peer relationships.
- Cross-project task linking; tasks can only be linked within the same project.
- Visual graph rendering or dependency network visualization.

## Decisions

### 1. Data Representation: `linkedTaskIds` Array
- **Decision**: Store linked tasks as an array of task IDs (`linkedTaskIds: string[]`) directly within the task document/object.
- **Rationale**: Minimal complexity, fits directly into existing task schema normalization in `js/validation.js`, easily synced to MongoDB and localStorage.
- **Alternatives considered**:
  - Separate `task_links` collection: Overkill for the current architecture; increases sync overhead between offline/localStorage and MongoDB.
  - Typed edge objects (`{ targetId, type }`): Adds unnecessary complexity when requirements state no restrictions and peer-level associations.

### 2. Bidirectional Maintenance
- **Decision**: Link operations update both tasks symmetrically.
  - When linking A to B: A includes B in `linkedTaskIds`, and B includes A in `linkedTaskIds`.
  - When unlinking A and B: B is removed from A, and A is removed from B.
- **Rationale**: Intuitive user experience. When inspecting either task, the relationship is apparent.

### 3. Non-Destructive Deletion and Defensive Cleanup
- **Decision**: When task A is deleted, all tasks linked to A have A removed from their `linkedTaskIds`. The linked tasks themselves are never deleted.
- **Rationale**: Unlike parent-child subtasks, linked tasks are peers without ownership semantics.
- **Defensive Rendering**: When rendering the linked tasks list in the UI, filter out any IDs that cannot be resolved in `allTasks` to guard against stale references.

### 4. UI Placement and Semantic Clarification
- **Decision**: Place the "Tareas Enlazadas" block in the main column directly above the tab container in both `js/modals.js` and `js/task-page.js`.
- **Decision**: Rename the subtask UI action from "Link Existing Task as Subtask" to "Asignar tarea existente como subtarea" (`btnLinkExistingSubtask` and `btnPageLinkExistingSubtask`).
- **Rationale**: Keeps links visible without tab navigation, while preventing confusion between hierarchical subtask assignment and non-hierarchical linking.

## Risks / Trade-offs

- **[Risk: Stale or ghost task IDs if delete fails partially]** → *Mitigation*: Both the backend `DELETE` handler and client-side deletion routines sweep tasks to pull the deleted ID from `linkedTaskIds`. Additionally, the frontend filters `linkedTaskIds` against active tasks during render.
- **[Risk: Duplicate link IDs added on concurrent actions]** → *Mitigation*: Linking checks `linkedTaskIds.includes(targetId)` before appending, and normalization in `js/validation.js` deduplicates IDs with a `Set`.
- **[Risk: Legacy data without `linkedTaskIds`]** → *Mitigation*: `validation.js` and `server.js` ensure `linkedTaskIds` defaults to `[]` whenever undefined or null.

## Migration Plan

- Backward-compatible schema addition. No database migrations needed.
- Existing JSON files, localStorage items, and MongoDB records without `linkedTaskIds` will be normalized to `[]` on load.
