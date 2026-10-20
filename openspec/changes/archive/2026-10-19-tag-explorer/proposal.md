# Proposal

## Why

As projects grow in size and complexity, tags become a primary taxonomy for categorizing, labeling, and cross-cutting tasks across different columns and workflows. Currently, users can only filter by a single tag via a dropdown in the board filters or view tag names in the admin panel table. There is no dedicated place to explore the tag inventory, search tags quickly, or inspect all tasks assigned to a specific tag at a glance.

Introducing a dedicated Tag Explorer view provides users with an organized way to browse all existing tags, search tags by text in real time, inspect the task list under any selected tag, and jump into task details or the Kanban board.

## What Changes

- **Tag Explorer Navigation**: Add a dedicated button/toggle in the application header (`Tags` / `Tag Explorer`) to open the Tag Explorer view, along with hash-based route support (`#/tags` and `#/tags/<tagName>`) for deep linking and back-button navigation.
- **Tag Listing & Live Search**: In the Tag Explorer, display all available tags in the current project along with their color badge and the count of associated tasks. Provide an instant text search input to filter the tag list by name.
- **Tag Task Inspection**: When a user selects a tag, display all tasks belonging to that tag in a structured panel, showing task attributes (title, status, priority, type, assignee, other tags).
- **Task Interaction & Quick Navigation**: Provide quick actions from the task list: click a task to view its full details (via the Task Page) or click a button to view and filter the Kanban board for that tag.
- **Empty & Feedback States**: Render clear empty states when a project has no tags, when no tags match the search query, or when a tag has no associated tasks.

## Capabilities

### New Capabilities
- `tag-explorer`: Provides a dedicated Tag Explorer view to browse project tags, filter them by text search, inspect all tasks belonging to a selected tag, and navigate between views.

### Modified Capabilities
None.

## Impact

- **Frontend**:
  - `index.html`: Add Tag Explorer button in the header menu; add `<section class="tags-view" id="tagExplorerView" hidden>` with two-pane layout (left: tag list & search; right: tag task details and list).
  - `js/tag-explorer.js`: New controller handling tag listing, search filtering, tag selection, rendering associated tasks, and view switching.
  - `js/app.js`: Integrate Tag Explorer view switching and header navigation.
  - `js/task-page.js`: Ensure navigation between Task Page and Tag Explorer respects history and view state.
  - `css/app.css`: Add styles for Tag Explorer container, search input, tag items list, active states, and task cards list.
- **Dependencies & Backend**:
  - No new dependencies or backend changes required; reuses existing `VG.Tags` registry and loaded tasks in memory.
