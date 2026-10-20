# Design

## Context

`vg-task-manager` provides a Kanban board, a dedicated Task Page (`#/task/<id>`), and an Admin Panel. Tags are managed globally in memory via `window.VG.Tags`, which loads the project's tag registry and provides helper methods like `usage(tasks)` to compute counts of tasks per tag. Currently, users can filter the board by a single tag using the filters dropdown or clicking a tag badge on a task card, but there is no dedicated overview of all project tags, no search functionality across tags, and no unified list showing all tasks belonging to any selected tag.

## Goals / Non-Goals

**Goals:**
- Provide a dedicated, responsive Tag Explorer view (`<section class="tag-explorer-view" id="tagExplorerView" hidden>`) accessible via a header navigation button and hash routing (`#/tags` and `#/tags/<tagName>`).
- Provide instant, case-insensitive text search to filter the list of tags.
- Present a master-detail two-pane layout: a tag list on the left with color indicators and task counters, and a task list on the right showing all tasks associated with the selected tag.
- Render rich task preview cards in the detail pane showing task type, status, priority, title, assignee, and additional tags.
- Enable direct navigation to the Task Page (`#/task/<id>`) by clicking any task card.
- Provide a "View on Board" button for the selected tag to navigate back to the Kanban board with the tag filter active.
- Support smooth transitions between Kanban Board, Tag Explorer, Task Page, and Admin Panel.

**Non-Goals:**
- In-place tag creation, editing, or deletion in the explorer view (tag administrative management remains in the Admin Panel Tags tab).
- Modifying backend endpoints or database structures (uses existing in-memory tasks and tags).

## Decisions

### Decision 1: Dedicated Controller Module (`js/tag-explorer.js`)
- **Rationale**: Isolates Tag Explorer DOM manipulation, search filter state, tag selection, and task card rendering into `window.VG.TagExplorer`, mirroring the architecture of `js/admin.js` and `js/task-page.js`.
- **Alternatives Considered**: Inlining into `js/app.js` or `js/board.js`. Rejected because it would bloat existing controllers and make state management harder to test and maintain.

### Decision 2: Two-Pane Master-Detail Layout
- **Rationale**: A split layout (left: searchable tag list; right: task cards for the selected tag) allows users to rapidly scan and switch between tags without losing their search filter or scroll position.
- **Alternatives Considered**: 
  - *Accordion or expandable cards*: Cluttered when tags have many tasks.
  - *Modal dialog*: Limited screen real estate and clashes with existing task edit modals.

### Decision 3: URL Hash Routing (`#/tags` and `#/tags/<tagName>`)
- **Rationale**: Integrating with `window.location.hash` allows bookmarking, direct linking to a tag's task collection, and reliable browser forward/back navigation, consistent with `#/task/<id>`.
- **Alternatives Considered**: Local state only without URL changes. Rejected because users expect back/forward browser navigation to work when switching between views.

### Decision 4: Header Navigation & View Switching Coordination
- **Rationale**: Add a `#btnOpenTagExplorer` button in the header menu. When in Tag Explorer, the button shows active state (or displays "Kanban Board" toggle). View transitions hide other main sections (`main.board-view`, `section#adminView`, `section#taskPage`) and manage `board-only` header items cleanly.

## Risks / Trade-offs

- **[Risk: Special characters in tag names in URL hash]**  
  → *Mitigation*: Encode tag names with `encodeURIComponent` when building URLs and decode with `decodeURIComponent` in route handlers, with fallback if tag is not found.
- **[Risk: Project switch or background sync while viewing Tag Explorer]**  
  → *Mitigation*: Hook into `replaceBoard` / project change notifications in `js/app.js` so that `window.VG.TagExplorer.refresh()` updates the tag counts and selected tag tasks automatically.
- **[Risk: Mobile / narrow screen responsiveness]**  
  → *Mitigation*: Use responsive CSS flexbox/media queries to stack the tag list and task details vertically on screens narrower than 768px.
