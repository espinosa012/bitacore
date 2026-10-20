# Spec Delta

## Purpose

Enables non-hierarchical, bidirectional task linking across tasks, allowing users to connect related work freely without altering subtask trees or triggering recursive deletions.

## ADDED Requirements

### Requirement: Non-hierarchical bidirectional task linking

The system SHALL allow users to link any task to any other task bidirectionally without altering parent-child hierarchy relationships or parent IDs.

#### Scenario: Link two tasks bidirectionally
- **WHEN** user links task A to task B
- **THEN** task B is added to task A's linked task list, task A is added to task B's linked task list, and neither task's `parentId` is modified

#### Scenario: Prevent self-linking
- **WHEN** user attempts to link a task to itself
- **THEN** system rejects the link operation and reports an error

#### Scenario: Prevent duplicate linking
- **WHEN** user attempts to link two tasks that are already linked
- **THEN** system rejects the duplicate link or treats the operation as an idempotent no-op

#### Scenario: Unlink two tasks
- **WHEN** user removes the link between task A and task B
- **THEN** task B is removed from task A's linked task list and task A is removed from task B's linked task list

### Requirement: Task Deletion Link Reference Cleanup

The system SHALL automatically remove references to a deleted task from all other tasks' linked lists without deleting the linked tasks.

#### Scenario: Delete a task that has linked tasks
- **WHEN** task A is deleted
- **THEN** task A is permanently deleted along with its subtasks, but all linked tasks remain existing and have task A removed from their `linkedTaskIds`

### Requirement: UI Task Linking Section

The system SHALL provide an always-visible task linking block in both the task edit modal and the full task page, positioned in the main column above the tab panels.

#### Scenario: View linked tasks in task edit modal
- **WHEN** user opens the task edit modal for a task
- **THEN** system displays the linked tasks block above the tab panel, showing available task selector, "Enlazar tarea" button, and list of linked tasks with status and unlink controls

#### Scenario: View linked tasks on task page
- **WHEN** user navigates to the dedicated task view page
- **THEN** system displays the linked tasks block above the tab panel, showing available task selector, "Enlazar tarea" button, and list of linked tasks with status and unlink controls

#### Scenario: Navigate to linked task
- **WHEN** user clicks on a linked task item in the list
- **THEN** system opens or navigates directly to that linked task

### Requirement: Board Card Linked Tasks Indicator

The system SHALL display an indicator badge with a link icon and counter on Kanban cards that have one or more linked tasks.

#### Scenario: Card has linked tasks
- **WHEN** a task has one or more linked tasks
- **THEN** the Kanban card displays a link icon and the count of linked tasks in its metadata footer

#### Scenario: Card has no linked tasks
- **WHEN** a task has zero linked tasks
- **THEN** the Kanban card does not render the linked tasks indicator
