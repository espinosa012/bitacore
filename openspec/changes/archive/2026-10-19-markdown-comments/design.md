# Design: Markdown Comments Support

## Context

See `proposal.md` for motivation. The application already vendors `EasyMDE` (`vendor/easymde`) and `DOMPurify` (`vendor/dompurify`), wrapped via `window.VG.Markdown` in `js/markdown.js`. Currently, task descriptions utilize EasyMDE for editing and previewing, while comments in both `js/modals.js` and `js/task-page.js` use plain HTML textareas and are rendered with `escapeHtml` under `.ui.comments .comment .text`.

## Goals / Non-Goals

**Goals:**
- Provide a reusable `compact` mode in `VG.Markdown.createEditor` with reduced height (~80-90px) and a curated set of toolbar buttons.
- Expose a `VG.Markdown.render(text)` helper returning sanitized HTML via DOMPurify with hardened external links (`target="_blank"`, `rel="noopener noreferrer"`).
- Mount the compact editor in both the Edit Task modal (`#newCommentText`) and the Task Page (`#pageCommentText`).
- Support `Ctrl/Cmd+Enter` inside CodeMirror to immediately submit the comment form.
- Refresh CodeMirror dimensions on modal tab activation (`switchTab('tabComments')`).
- Adjust CSS styles so Markdown rendered within comments displays correctly in dark mode without `white-space: pre-wrap` distortion.

**Non-Goals:**
- Comment editing or deletion (comments remain append-only).
- `@mention` auto-completion or interactive emoji pickers.
- Backend markdown transformation (Markdown parsing and sanitization remain client-side).

## Decisions

### Decision 1: Compact toolbar button set
- **Choice**: Offer `bold`, `italic`, `quote`, `unordered-list`, `code`, `link`, and `preview` with min-height ~85px.
- **Rationale**: A comment form needs quick formatting without cluttering the screen or pushing the existing comment thread off-screen.
- **Alternatives considered**:
  - Full toolbar: Takes up excessive vertical space (~140px+ toolbar) and includes unnecessary tools like side-by-side or fullscreen.
  - No toolbar (plain textarea with markdown parsing): Lacks affordances for users unfamiliar with markdown syntax and lacks live preview.

### Decision 2: Centralized `VG.Markdown.render` using EasyMDE parser + DOMPurify
- **Choice**: Implement `VG.Markdown.render(text)` using EasyMDE's internal marked parser configuration coupled with DOMPurify sanitization.
- **Rationale**: Reuses existing vendored libraries without adding bundle size, ensuring consistency between description previews and comment rendering.

### Decision 3: CodeMirror keymap for `Ctrl/Cmd+Enter`
- **Choice**: Bind `Ctrl-Enter` and `Cmd-Enter` inside the EasyMDE instance (or via CodeMirror extraKeys/shortcuts) to trigger the parent form's submit action.
- **Rationale**: Preserves the existing keyboard shortcut behavior expected by users, even though the underlying textarea is replaced by CodeMirror.

### Decision 4: Lifecycle management for modal tabs
- **Choice**: When switching to `tabComments`, invoke `codemirror.refresh()` on the modal's comment editor.
- **Rationale**: CodeMirror instances mounted in elements with `display: none` cannot compute accurate cursor position or dimensions until made visible.

## Risks / Trade-offs

- **[Hidden Tab Dimension Bug]** → When the modal opens on the Subtasks or Attachments tab, the comment editor is hidden.
  *Mitigation*: Hook into `switchTab('tabComments')` and `openEditModal` to run `.codemirror.refresh()` with a small timeout (50ms).
- **[CSS Whitespace Collision]** → `.ui.comments .comment .text` has `white-space: pre-wrap;`, which causes extra spacing inside Markdown paragraphs, code blocks, and list items.
  *Mitigation*: Scope a class `.comment-body` / `.comment-text` that resets `white-space: normal` on the container while keeping code blocks and pre elements formatted correctly.
