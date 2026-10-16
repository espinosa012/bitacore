# vg-task-manager

A modern, cloud-connected task manager and Kanban board backed by **MongoDB Atlas** via [vg-mongo-proxy](https://github.com/espinosa012/vg-mongo-proxy), featuring GridFS file attachments storage, user authentication, multi-criteria Kanban filters, a responsive dark [Fomantic-UI](https://fomantic-ui.com/) (Semantic UI) interface, and full compatibility with static hosting (such as **GitHub Pages**).

---

## Architecture & Features

- **GitHub Pages & Jamstack Ready**:
  - 100% client-side compatible: no local Node server required when hosted on GitHub Pages or any static CDN.
  - Communicates directly over HTTPS with [vg-mongo-proxy](https://github.com/espinosa012/vg-mongo-proxy) (FastAPI + Motor backend).
  - Secure credential isolation: database connection strings are never exposed in the browser.
- **MongoDB Atlas Integration**:
  - Connect with your deployed `vg-mongo-proxy` URL and `x-api-key`.
  - Target database: `vg-task-manager` (configurable).
  - Collections: `tasks`, `tags`, `users`, and GridFS `fs.files` / `fs.chunks`.
  - Real-time synchronization: tasks created, modified, reordered, or deleted are persisted directly to MongoDB.
- **GridFS Cloud Attachments**:
  - Attach files to tasks (images, PDFs, documents, logs, audio, video, code, etc.).
  - Uploaded, streamed, and deleted directly via GridFS endpoints.
  - Inline preview and direct download support.
- **User Authentication & Multi-User Filtering**:
  - Register and login with secure PBKDF2 password encryption via native Web Crypto API.
  - Task attribution: tasks display creator and assigned user.
  - Multi-criteria filter popover: filter by Assignee, Creator, Priority, and Tags.
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

## Deployment & Usage

### 1. Hosted on GitHub Pages
1. Deploy `vg-task-manager` to GitHub Pages.
2. Ensure you have your [vg-mongo-proxy](https://github.com/espinosa012/vg-mongo-proxy) deployed (e.g. on Render, Fly.io, or VPS) with CORS enabled.
3. Open the app in your browser.
4. When prompted, enter:
   - **Proxy API URL**: e.g. `https://your-proxy-domain.com`
   - **Proxy API Key**: the secret configured in `PROXY_API_KEY` on your proxy
   - **Database Name**: `vg-task-manager` (default)
5. Click **Connect & Load Tasks**, then log in or register your user account.

### 2. Running Locally
You can also run locally with any static web server:
```bash
npx serve .
# or
python3 -m http.server 8080
# or using the existing server:
npm start
```
Open `http://localhost:8080` in your browser.

---

## License

MIT © Adrián R. Espinosa
