# vg-task-manager

A lightweight, self-contained task manager and Kanban board built as a single HTML file with JSON persistence, responsive dark UI, and zero external runtime dependencies.

![vg-task-manager preview](preview.png) *(optional)*

## Features

- **Single-File Architecture**: The complete web application (HTML5, Vanilla CSS, and JavaScript) lives in `index.html`.
- **JSON File Persistence**: Direct two-way synchronization with `tasks.json` via HTTP server and File System Access API.
- **Drag & Drop Reordering**:
  - Drag tasks across status columns.
  - Reorder vertically within any category with fluid drop position indicators.
- **Collapsible Columns**: Collapse columns with one click to keep your view focused.
- **Task Hierarchy & History**:
  - Full status transition history tracking with automatic timestamps and change reasons.
  - Interactive discussion comments per task.
  - OpenSpec ID integration for traceability with development workflows.
- **Priorities & Filters**:
  - Color-coded priority tags: *Blocker*, *High*, *Medium-High*, *Medium*, *Low*.
  - Real-time text search (names, descriptions, and OpenSpec IDs).
- **Zero Runtime Dependencies**: Serves locally with native Node.js (no npm install required).

## Quick Start

### Option 1: Run with Node.js
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
Open `index.html` directly in any modern browser:
- Use **"Link tasks.json"** (via File System Access API) to enable auto-save to disk.
- Or use the built-in JSON import / export buttons.

## Task Schema

Tasks are stored in `tasks.json` in clean, human-readable format:

```json
{
  "id": "task-001",
  "name": "Implement authentication",
  "description": "Details, requirements, and acceptance criteria.",
  "openspec-id": "auth-jwt-spec",
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
  "comments": []
}
```

## License

MIT
