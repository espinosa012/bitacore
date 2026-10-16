# vg-task-manager

A modern, privacy-first task manager and Kanban board with task attachments, ZIP archiving, local folder synchronization, a responsive dark [Fomantic-UI](https://fomantic-ui.com/) (Semantic UI) interface, and zero external build tooling.

Live Demo (GitHub Pages): [https://espinosa012.github.io/vg-task-manager/](https://espinosa012.github.io/vg-task-manager/)

---

## Features

- **Semantic UI interface**: Built with [Fomantic-UI](https://fomantic-ui.com/), the maintained fork of Semantic UI (menus, cards, modals, forms, feeds, toasts and dialogs).
- **Modular Architecture**: Plain JavaScript modules (`js/`) and a small stylesheet (`css/`) on top of the framework.
- **File Attachments**:
  - Attach any file type to tasks: images, markdown, text, PDFs, audio, videos, code, etc.
  - Automatically identifies files with intuitive icons and formatted file sizes.
  - Optional custom display names and descriptions per attachment.
  - Preview, open in browser, or download attachments directly from the board.
  - Persisted in high-capacity `IndexedDB` in the browser.
- **ZIP Export & Import**:
  - Download complete archives containing `tasks.json` at root and attachments neatly organized in `attachments/<taskId>/<filename>`.
  - Only tasks with attachments have subdirectories in `attachments/`.
  - Drag and drop or upload `.zip` archives directly to restore all tasks and attachments.
- **Local Directory Synchronization ("Sincronía")**:
  - Click **"Open Folder"** to link a directory containing `tasks.json` and `attachments/<taskId>/`.
  - Edits and new attachments are written to disk in real time.
  - Works in every browser, through the best available backend:

    | Browser | How it syncs |
    |---|---|
    | Chrome / Edge | File System Access API: pick any folder, live 2-way sync |
    | Safari / Firefox + local agent | `node server.js /path/to/folder`: live 2-way sync through the local agent |
    | Safari / Firefox without agent | Read-only: the folder is loaded, and you save changes with **Download ZIP** |

  - **Local agent**: `server.js` serves the app and exposes a small sync API (`/api/tasks`, `/api/attachments/...`) restricted to `localhost` and the GitHub Pages origin. Open `http://localhost:8766/` (recommended in Safari), or keep it running while you use GitHub Pages: the page detects it on port 8766.
- **Task Page** (`#/task/<id>`):
  - Open any task as a full page from the card's corner button or the edit modal's **Open page** button (unsaved modal edits carry over).
  - Edit the title, status, priority and OpenSpec ID; changes are a draft until **Save** (`Ctrl/Cmd+S`), with an unsaved-changes guard.
  - Attachments grid with inline previews: images, text/code excerpts, audio and video players; drop several files at once.
  - Comments, history timeline and task metadata side by side.
- **Markdown Descriptions**:
  - Task descriptions use an embedded Markdown editor ([EasyMDE](https://github.com/Ionaru/easy-markdown-editor)) with preview, checklists, tables and code blocks; the task page adds side-by-side and fullscreen modes.
  - Rendered Markdown is sanitized with [DOMPurify](https://github.com/cure53/DOMPurify); cards show a plain-text excerpt.
- **Drag & Drop Workflow**:
  - Drag cards across columns (*Planned*, *In Progress*, *In Review*, *Done*, *Blocked*).
  - Pixel-perfect vertical reordering within columns with live drop indicators.
  - Direct window drag & drop for importing `.json` or `.zip` files.
- **Collapsible Columns**: Collapse columns to a compact strip with one click.
- **Traceability & History**:
  - Chronological status transition history tracking with reasons.
  - Discussion comments thread per task.
  - OpenSpec ID integration for traceability with development workflows.
- **Tags & Bulk Tagging**:
  - Tasks can have any number of tags; the board's tag registry is saved in `tasks.json`.
  - Add tags from a card (tag button), the edit modal or the task page. Suggestions appear as you type, and a tag that does not exist yet is created automatically with its own color.
  - Filter the board by tag next to the priority filter, or click a tag on a card to filter by it.
  - **Bulk Tag Assignment**: Assign tags to multiple tasks in bulk after filtering (e.g. "Tag Filtered") or by selecting specific cards via custom checkboxes. A floating action bar and keyboard shortcut (`T`) provide rapid tagging while preserving existing tags.
- **Priorities & Search**:
  - Color-coded priority tags (*Blocker*, *High*, *Medium-High*, *Medium*, *Low*).
  - Fast search matching task titles, descriptions, OpenSpec IDs, tags, and attachment file names.

---

## Quick Start

### Option 1: Run with local server (Node.js)
```bash
# Clone the repository
git clone https://github.com/espinosa012/vg-task-manager.git
cd vg-task-manager

# Start the server (opens automatically on port 8766)
npm start
# or
node server.js

# Sync a specific folder (tasks.json + attachments/) — works in Safari and Firefox too
node server.js ~/Documents/my-tasks
```

### Option 2: Open directly in your browser
Open `index.html` directly in any modern browser or visit the [GitHub Pages Deployment](https://espinosa012.github.io/vg-task-manager/).

---

## Folder & ZIP Structure

When downloading ZIP or linking a local directory, the file structure is:

```
my-task-folder/
├── tasks.json
└── attachments/
    ├── task-1729100000-101/
    │   ├── diagram.png
    │   └── notes.txt
    └── task-1729100000-205/
        └── specification.pdf
```

---

## Task Schema

`tasks.json` holds the tag registry and the tasks, with strict schema validation:

```json
{
  "tags": [
    { "name": "frontend", "color": "blue" },
    { "name": "crafting", "color": "teal" }
  ],
  "tasks": [ { ...task } ]
}
```

A plain array of tasks (the previous format) is still accepted; its tags are added to the registry on load.

Each task:

```json
{
  "id": "task-001",
  "name": "Implement crafting menu",
  "description": "Details, requirements, and acceptance criteria.",
  "openspec-id": "crafting-spec",
  "priority": "high",
  "status": "planned",
  "tags": ["frontend", "crafting"],
  "created_at": "2026-10-16T18:00:00.000Z",
  "updated_at": "2026-10-16T18:00:00.000Z",
  "history": [
    {
      "from_status": null,
      "to_status": "planned",
      "timestamp": "2026-10-16T18:00:00.000Z",
      "reason": "Initial task creation"
    }
  ],
  "comments": [],
  "attachments": [
    {
      "id": "att-1729100000-1",
      "filename": "diagram.png",
      "name": "UI Architecture",
      "description": "Initial layout sketch",
      "size": 104250,
      "type": "image/png",
      "created_at": "2026-10-16T18:05:00.000Z"
    }
  ]
}
```

---

## Third-party libraries

Vendored in the repository, no build step or CDN required:

| Library | Version | License | Path |
|---|---|---|---|
| Fomantic-UI (Semantic UI) | 2.9.4 | MIT | `vendor/fomantic-ui/` |
| jQuery | 3.7.1 | MIT | `vendor/jquery/` |
| JSZip | — | MIT / GPLv3 | `jszip.min.js` |
| EasyMDE | 2.21.0 | MIT | `vendor/easymde/` |
| DOMPurify | 3.4.16 | MPL-2.0 / Apache-2.0 | `vendor/dompurify/` |

---

## License

MIT
