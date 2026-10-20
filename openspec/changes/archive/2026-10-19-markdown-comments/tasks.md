# Tasks: Markdown Comments Support

## 1. Markdown Helper & Compact Editor

- [x] 1.1 Extend `VG.Markdown.createEditor` in `js/markdown.js` with a `compact` mode (curated toolbar: bold, italic, quote, unordered-list, code, link, preview; min-height ~85px) and verify the toolbar buttons and height render correctly.
- [x] 1.2 Implement `VG.Markdown.render(text)` in `js/markdown.js` using EasyMDE's internal parser and DOMPurify sanitization, and verify sanitized HTML output with hardened external links.
- [x] 1.3 Add CSS styles in `css/markdown.css` / `css/app.css` for `.comment-body` / `.comment-text` to support Markdown typography and code blocks without `white-space: pre-wrap` line-break distortion.

## 2. Modal Comments Integration

- [x] 2.1 Mount the compact EasyMDE editor on `#newCommentText` in `js/modals.js` and add a layout refresh call (`codemirror.refresh()`) when switching to `tabComments`.
- [x] 2.2 Wire `Ctrl/Cmd+Enter` inside the modal comment editor to trigger comment posting, and ensure the editor value is cleared and preview mode reset on submission.
- [x] 2.3 Update `renderCommentList` in `js/modals.js` to render comment bodies using `VG.Markdown.render(c.text)` and verify formatted comments display properly.

## 3. Task Page Comments Integration

- [x] 3.1 Mount the compact EasyMDE editor on `#pageCommentText` in `js/task-page.js` with `Ctrl/Cmd+Enter` submission and editor reset after posting.
- [x] 3.2 Add editor clearing and preview resetting when opening or switching tasks in `js/task-page.js`, verifying clean state across task transitions.

## 4. Verification

- [x] 4.1 Perform end-to-end testing of comment creation, live preview, formatting (bold, italic, lists, quotes, inline code, code blocks, links), and persistence in both the modal and full task page.
