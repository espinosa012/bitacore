# vg-task-manager

A modern, cloud-connected task manager and Kanban board backed by **MongoDB Atlas**, featuring attached files storage, a responsive dark [Fomantic-UI](https://fomantic-ui.com/) (Semantic UI) interface, and zero external build tooling.

---

## Architecture & Features

- **MongoDB Atlas Integration**:
  - Direct cloud database connection: provide your MongoDB Atlas connection string (`mongodb+srv://...`) directly in the app.
  - Target database: `vg-task-manager`.
  - Target collection: `tasks` (replaces local JSON files).
  - Clean access control: tasks remain hidden until the user introduces the connection string.
  - Real-time two-way synchronization: tasks created, modified, reordered, or deleted are persisted directly to MongoDB.
- **Cloud File Attachments**:
  - Attach files to tasks (images, PDFs, documents, audio, videos, code, etc.).
  - Uploaded and stored directly in the `vg-task-manager` MongoDB database (`attachments` collection).
  - Inline preview and download support.
- **Semantic UI Interface**:
  - Built with [Fomantic-UI](https://fomantic-ui.com/) (menus, cards, modals, forms, feeds, toasts, and dialogs).
  - Modern typography and clean dark theme.
- **Task Page** (`#/task/<id>`):
  - Open any task as a dedicated full page with inline markdown editor, attachments grid, comments thread, and history.
  - Status, priority, and OpenSpec ID integration with draft saving guards.
- **Drag & Drop Workflow**:
  - Drag cards across columns (*Planned*, *In Progress*, *In Review*, *Done*, *Blocked*).
  - Vertical reordering within columns with live drop indicators.
- **Tags & Bulk Tagging**:
  - Flexible tag registry saved in MongoDB.
  - Filter tasks by tag or bulk-assign tags to multiple tasks simultaneously (shortcut `T`).
- **Priorities & Search**:
  - Color-coded priority badges (*Blocker*, *High*, *Medium-High*, *Medium*, *Low*).
  - Fast search matching task titles, descriptions, OpenSpec IDs, tags, and attachment file names (shortcut `/`).

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the application
```bash
npm start
# or
node server.js
```
The server will open at `http://localhost:8766/`.

You can also provide a default connection string via CLI or environment variable:
```bash
node server.js "mongodb+srv://admin:password@cluster.mongodb.net/"
# or
VG_MONGO_URI="mongodb+srv://admin:password@cluster.mongodb.net/" npm start
```

### 3. Connect to MongoDB Atlas
When you access the app in your browser, a connection modal will prompt you for your MongoDB connection string.
Enter your connection string and click **Connect & Load Tasks**. All tasks in the `vg-task-manager` database `tasks` collection will be loaded and displayed on the board.

---

## License

MIT © Adrián R. Espinosa
