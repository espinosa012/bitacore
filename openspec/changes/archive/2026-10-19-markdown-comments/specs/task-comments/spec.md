# Spec Delta: Task Comments

## Purpose

Provides rich Markdown authoring and sanitized formatted rendering for task comments across the application.

## ADDED Requirements

### Requirement: Markdown Comment Rendering
The system SHALL render comment text formatted as Markdown into sanitized HTML, supporting emphasis, lists, blockquotes, code spans, code blocks, and links while stripping malicious markup.

#### Scenario: Formatted comment rendering
- **WHEN** a task displays a comment containing Markdown syntax
- **THEN** the comment is rendered as formatted HTML with links configured with target="_blank" and rel="noopener noreferrer"

#### Scenario: Plain text backward compatibility
- **WHEN** a comment contains plain text without Markdown syntax
- **THEN** the text is rendered legibly without layout or line-break distortion

### Requirement: Compact Markdown Comment Editor
The system SHALL provide a compact Markdown editor for composing comments in both the task edit modal and the task page, featuring a streamlined toolbar and live preview toggle.

#### Scenario: Compact toolbar controls
- **WHEN** a user opens the comment composer in the edit modal or the task page
- **THEN** a compact toolbar is displayed with bold, italic, quote, list, code, link, and preview actions

#### Scenario: Modal tab layout refresh
- **WHEN** a user switches to the Comments tab in the task edit modal
- **THEN** the editor refreshes its viewport dimensions to ensure accurate cursor positioning and sizing

### Requirement: Comment Submission and Editor Reset
The system SHALL support submitting comments via button click or keyboard shortcut, persisting the comment and resetting the editor state.

#### Scenario: Submission via shortcut
- **WHEN** a user presses Ctrl+Enter or Cmd+Enter while focusing the comment editor
- **THEN** the comment is added to the task, the editor content is cleared, and preview mode is toggled off if it was active
