# tag-explorer Specification

## Purpose

Provides a dedicated Tag Explorer view to inspect, search, and navigate project tags and their associated tasks in vg-task-manager.

## Requirements

### Requirement: Tag Explorer Navigation and View Toggling
The system SHALL provide a dedicated navigation trigger in the application header to switch between the Kanban Board and the Tag Explorer view, and support URL hash routing (`#/tags`).

#### Scenario: Open Tag Explorer from header
- **WHEN** user clicks the "Tags" navigation button in the application header
- **THEN** the Kanban board and Task Page are hidden, the Tag Explorer view is displayed, and the URL hash updates to `#/tags`

#### Scenario: Return to Kanban Board from Tag Explorer
- **WHEN** user is in the Tag Explorer view and clicks the board button or header brand
- **THEN** the Tag Explorer view is hidden and the Kanban board is restored

### Requirement: Tag Listing and Usage Metrics
The Tag Explorer SHALL display all unique tags registered in the active project along with their configured color badge and the total count of tasks currently referencing each tag.

#### Scenario: Display project tags
- **WHEN** user opens the Tag Explorer in a project that has registered tags
- **THEN** the system lists all tags in alphabetical order, rendering each tag's colored badge and task count badge

#### Scenario: Empty tag registry
- **WHEN** the active project has no tags
- **THEN** the Tag Explorer displays a friendly empty state message indicating that no tags exist yet

### Requirement: Live Tag Search and Filtering
The Tag Explorer SHALL provide a text search input that dynamically filters the visible tag list in real time as the user types.

#### Scenario: Search matching tags
- **WHEN** user enters text into the Tag Explorer search input
- **THEN** only tags whose names match the query (case-insensitively) are displayed in the tag list

#### Scenario: Search with no matching tags
- **WHEN** user enters a query that matches no tags in the active project
- **THEN** the tag list displays a "No matching tags found" message and an option to clear the search input

### Requirement: Inspect Tasks by Selected Tag
When a tag is selected in the Tag Explorer, the system SHALL display a details panel showing all tasks in the active project that contain that tag.

#### Scenario: Select tag to view tasks
- **WHEN** user clicks on a tag in the tag list
- **THEN** that tag is marked as active, its details header is shown, and all tasks assigned to that tag are rendered with their title, status, priority, type, assignee, and tags

#### Scenario: Select tag with zero tasks
- **WHEN** user selects a tag that is not currently assigned to any tasks
- **THEN** the details panel indicates that no tasks are currently associated with this tag

### Requirement: Task Details and Kanban Navigation from Tag Explorer
The Tag Explorer SHALL allow users to open a task's full details or jump to the Kanban board pre-filtered by the selected tag.

#### Scenario: Open task details from Tag Explorer
- **WHEN** user clicks on a task card or task title in the Tag Explorer task list
- **THEN** the system opens the Task Page (`#/task/<id>`) for that task

#### Scenario: Filter Kanban board by selected tag
- **WHEN** user clicks the "View on Board" button for the currently selected tag
- **THEN** the system switches to the Kanban board view, sets the tag filter to the selected tag, and updates the board display
