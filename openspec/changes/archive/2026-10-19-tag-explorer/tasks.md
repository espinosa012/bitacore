# Tasks

## 1. UI Markup & Styling

- [x] 1.1 Add `<section class="tag-explorer-view" id="tagExplorerView" hidden>` in `index.html` with two-pane layout (left: tag search input, tag count summary, scrollable tag list; right: selected tag header, "View on Board" button, and task cards list container with empty states); verify markup in `index.html`
- [x] 1.2 Add navigation button `#btnOpenTagExplorer` in the header menu in `index.html` with tags icon and label; verify header element rendering
- [x] 1.3 Add CSS styles in `css/app.css` for Tag Explorer layout, responsive sidebar and detail panes, search input, active tag selection highlight, tag counters, and task cards list; verify dark theme styling

## 2. Tag Explorer Controller & Search

- [x] 2.1 Create `js/tag-explorer.js` defining `window.VG.TagExplorer` with methods to load project tags, compute usage counts, and filter tags dynamically as user types in the search input; verify real-time search filtering
- [x] 2.2 Implement task card rendering in `js/tag-explorer.js` for the selected tag displaying title, status, priority, type, assignee, and tag pills, plus empty state when no tasks match; verify task card display
- [x] 2.3 Implement interaction handlers in `js/tag-explorer.js` for clicking a task card (opening Task Page `#/task/<id>`) and clicking "View on Board" (switching to Kanban view with the tag filter active); verify user navigation

## 3. View Routing & App Integration

- [x] 3.1 Add `<script src="js/tag-explorer.js"></script>` to `index.html` in proper dependency order before `js/app.js`; verify module loads without console errors
- [x] 3.2 Update `js/app.js` to coordinate view switching between Kanban Board, Tag Explorer, Admin Panel, and Task Page, toggling header button states and calling `TagExplorer.refresh()` on board reload or project change; verify view switching logic
- [x] 3.3 Implement hash route handling for `#/tags` and `#/tags/<tagName>` supporting direct deep linking and browser back/forward navigation; verify URL changes update the view correctly

## 4. End-to-End Verification

- [x] 4.1 Perform end-to-end verification of the Tag Explorer workflow: open from header navigation, search tags by text query, select a tag, inspect associated task cards, navigate to a task's full page, and jump to the Kanban board via "View on Board"; verify all interactions function without console errors
