# vg-task-manager

A modern, privacy-first task manager and Kanban board with task attachments, ZIP archiving, local folder synchronization, responsive dark UI, and zero external build tooling.

Live Demo (GitHub Pages): [https://espinosa012.github.io/vg-task-manager/](https://espinosa012.github.io/vg-task-manager/)

---

## Features

- **Modular Architecture**: Organized into clean CSS components (`css/`) and JavaScript modules (`js/`).
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
  - Click **"Open Folder"** to select a directory on your machine via the File System Access API.
  - Reads `tasks.json` and loads all files under `attachments/<taskId>/`.
  - Automatically synchronizes edits and new attachments directly to your disk in real time.
- **Drag & Drop Workflow**:
  - Drag cards across columns (*Planned*, *In Progress*, *In Review*, *Done*, *Blocked*).
  - Pixel-perfect vertical reordering within columns with live drop indicators.
  - Direct window drag & drop for importing `.json` or `.zip` files.
- **Collapsible Columns**: Collapse columns to a compact strip with one click.
- **Traceability & History**:
  - Chronological status transition history tracking with reasons.
  - Discussion comments thread per task.
  - OpenSpec ID integration for traceability with development workflows.
- **Priorities & Search**:
  - Color-coded priority tags (*Blocker*, *High*, *Medium-High*, *Medium*, *Low*).
  - Fast search matching task titles, descriptions, OpenSpec IDs, and attachment file names.

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

Tasks are stored in `tasks.json` with strict schema validation:

```json
{
  "id": "task-001",
  "name": "Implement crafting menu",
  "description": "Details, requirements, and acceptance criteria.",
  "openspec-id": "crafting-spec",
  "priority": "high",
  "status": "planned",
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

## License

MIT
