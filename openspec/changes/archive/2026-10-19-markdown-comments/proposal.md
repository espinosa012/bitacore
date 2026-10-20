# Proposal: Markdown Comments Support

## Why

Currently, task comments in vg-task-manager are typed into plain textareas and displayed as escaped plain text. When collaborating on technical tasks, users frequently need formatting such as inline code, code blocks, lists, quotes, and links to communicate clearly. Adding Markdown support and a dedicated compact editor improves communication while preserving complete backward compatibility with existing plain-text comments.

## What Changes

- Add Markdown rendering for comments with XSS sanitization via DOMPurify and external link hardening (`target="_blank"`, `rel="noopener noreferrer"`).
- Provide a `compact` mode in `VG.Markdown.createEditor` with a streamlined toolbar (bold, italic, quote, list, code, link, preview) and reduced min-height (~80-90px) suitable for comment forms.
- Integrate the compact Markdown editor into the Edit Task modal (Comments tab).
- Integrate the compact Markdown editor into the full Task Page (Comments section).
- Support `Ctrl/Cmd+Enter` inside the CodeMirror comment editor to post comments immediately.
- Handle CodeMirror dimension recalculation (`codemirror.refresh()`) when switching to the Comments tab in the modal.
- Automatically clear the editor and reset preview mode when a comment is submitted or when switching active tasks.
- Adjust comment styling in CSS so Markdown elements (paragraphs, code blocks, lists, blockquotes) render cleanly without unwanted `white-space: pre-wrap` artifacts.

## Capabilities

### New Capabilities
- `task-comments`: Support for creating and rendering task comments formatted in Markdown across modals and task pages with sanitization and compact editor controls.

### Modified Capabilities
*(None - existing API and data schema remain backward compatible)*

## Impact

- **Frontend Code**:
  - `js/markdown.js`: Add `compact` toolbar option and `render` helper method.
  - `js/modals.js`: Mount compact editor on `#newCommentText`, refresh on `tabComments` tab switch, update `renderCommentList` to render sanitized Markdown.
  - `js/task-page.js`: Mount compact editor on `#pageCommentText`, clear/reset editor when switching tasks or posting.
  - `css/app.css` & `css/markdown.css`: Ensure comment text styling renders Markdown elements (code blocks, lists, quotes) with consistent dark theme styling.
- **Data & APIs**:
  - No changes required to storage or backend: comments continue to store the comment body in `text` as a string.
- **Dependencies**:
  - No new dependencies; uses vendored EasyMDE and DOMPurify.
