# Design

## Context

Task types in `vg-task-manager` are managed at multiple layers:
1. Client constants: `js/constants.js` defines `TASK_TYPES` with metadata (id, label, icon, color) and `TASK_TYPE_MAPPINGS` for alias resolution.
2. Backend defaults and persistence: `server.js` defines `DEFAULT_TASK_TYPES` and seeds per-project task types into the `task_types` MongoDB collection under document IDs `<projectId>:<typeId>`.
3. Client synchronization fallback: `js/mongo-sync.js` defines a client-side copy of `DEFAULT_TASK_TYPES` used when operating offline or initializing project structures.
4. Static UI fallbacks: `index.html` contains static `<option>` tags in type dropdowns before dynamic population via `refreshTaskTypeDropdowns()`.
5. Visual rendering: `js/board.js`, `js/task-page.js`, and `js/modals.js` render badges and select controls dynamically based on `window.VG.Constants.TASK_TYPES`.

See `proposal.md` for the motivation and high-level scope.

## Goals / Non-Goals

**Goals:**
- Provide a first-class `openspec-change` task type with display name "OpenSpec Change", Fomantic UI icon `code branch`, and color `purple`.
- Support common aliases (`openspec-change`, `openspec_change`, `openspec`, `change`) in `canonicalTaskType` mapping.
- Update `DEFAULT_TASK_TYPES` in both backend (`server.js`) and client (`js/mongo-sync.js`, `js/constants.js`).
- Update static `<select>` elements in `index.html` for offline/fallback consistency.
- Ensure existing projects gain `openspec-change` idempotently without overwriting user customizations.

**Non-Goals:**
- Altering the existing task metadata field `openspec-id`.
- Automatic synchronization or parsing of local `openspec/` directories from the browser.
- Changing task state workflows or Kanban board column mechanics.

## Decisions

### Decision 1: Type Identifier and Visual Styling
- **Choice**: Identifier `openspec-change`, Display Name `OpenSpec Change`, Icon `code branch`, Color `purple`.
- **Rationale**: `code branch` clearly conveys specification changes and branches. `purple` provides high contrast against existing task types (`blue` for task, `red` for bug, `teal` for analysis, `green` for feature), while leaving `teal` dedicated to the existing OpenSpec ID chip.
- **Alternatives considered**:
  - `openspec` as ID: Less descriptive and potentially conflicting if sub-features of OpenSpec are introduced later.
  - `file alternate outline` icon: Already used for the task card OpenSpec ID chip; reusing it for the task type would cause visual redundancy.

### Decision 2: Idempotent Seeding for Active and Existing Projects
- **Choice**: In `server.js`, expand `ensureProjectTaskTypes(db, projectId)` to ensure all `DEFAULT_TASK_TYPES` documents are upserted with `$setOnInsert` for each registered project, rather than only seeding when total count is 0.
- **Rationale**: Projects created prior to this change already have 4 types in MongoDB (`countDocuments > 0`). Checking only `count === 0` would prevent existing projects from receiving the new `OpenSpec Change` type unless manually created by an administrator.
- **Alternatives considered**:
  - Requiring administrators to manually add the type in the Admin Panel: Poor user experience for existing installations.
  - Wiping and re-seeding task types: Destructive to custom types.

### Decision 3: Alias Normalization
- **Choice**: Register `openspec-change`, `openspec_change`, `openspec`, and `change` in `TASK_TYPE_MAPPINGS` in `js/constants.js`.
- **Rationale**: Ensures resilience when tasks are imported via JSON, manipulated via API, or created from external tools without strict hyphenation.

## Risks / Trade-offs

- **[Risk]** Existing projects in MongoDB may have deleted a task type deliberately and could have `openspec-change` inserted on server restart.
  - **Mitigation**: Seeding uses `$setOnInsert` scoped to `openspec-change` doc ID (`<projectId>:openspec-change`). It only adds the type if absent and does not alter existing types.
- **[Risk]** Offline/Local storage mode divergence from MongoDB mode.
  - **Mitigation**: Update `TASK_TYPES` in `js/constants.js` and `DEFAULT_TASK_TYPES` in `js/mongo-sync.js` identically so offline storage and MongoDB behave consistently.
