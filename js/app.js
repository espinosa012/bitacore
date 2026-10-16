/**
 * vg-task-manager: Main Application Orchestrator
 */
(function() {
  window.VG = window.VG || {};
  const Storage = window.VG.Storage;
  const Validation = window.VG.Validation;
  const ZipManager = window.VG.ZipManager;
  const FsSync = window.VG.FsSync;
  const Board = window.VG.Board;
  const Modals = window.VG.Modals;
  const UI = window.VG.UI;
  const Tags = window.VG.Tags;
  const { escapeHtml } = window.VG.Constants;

  let tasks = [];

  function getTasks() {
    return tasks;
  }

  function setTasks(newTasks) {
    tasks = newTasks || [];
  }

  /** Replaces the whole board (import, folder, clear) with its tag registry */
  function replaceBoard(newTasks, rawTags = []) {
    tasks = newTasks || [];
    Tags.load(rawTags, tasks);
    refreshTagFilter();
  }

  /** The tasks.json document: tag registry + tasks */
  function buildDocument() {
    return { tags: Tags.getAll(), tasks };
  }

  /** Rebuilds the board's tag filter options, keeping the current choice */
  function refreshTagFilter() {
    const select = document.getElementById('tagFilter');
    if (!select) return;
    const current = select.value;
    const usage = Tags.usage(tasks).sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = '<option value="all">All tags</option>' +
      usage.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${t.count})</option>`).join('');
    select.value = usage.some(t => t.name === current) ? current : 'all';
    select.disabled = usage.length === 0;
  }

  // True when the board has changes that exist only in this tab
  // (not written to a synced folder and not exported since).
  let hasUnsavedChanges = false;

  function markDirty() {
    hasUnsavedChanges = tasks.length > 0;
  }

  function markClean() {
    hasUnsavedChanges = false;
  }

  function persistChanges(notifyMessage = 'Saved') {
    refreshTagFilter();
    Storage.saveLocalTasks(tasks);
    if (!FsSync.isLiveSync()) markDirty();

    // If local folder is connected, save directly to tasks.json on disk ("sincronia")
    if (FsSync.isLiveSync()) {
      FsSync.saveTasksToDirectory(buildDocument()).then(saved => {
        if (!saved) {
          markDirty();
          showToast(`Could not write tasks.json to "${FsSync.getLinkedDirName()}". Use Download ZIP to keep your changes.`, 'error', 7000);
        } else if (notifyMessage) {
          showToast(`${notifyMessage} & synced to folder`, 'success');
        }
      });
      return;
    }

    if (notifyMessage) {
      showToast(notifyMessage, 'info');
    }
  }

  function showToast(message, type = 'info', duration = 3500) {
    UI.toast(message, type, duration);
  }

  function updateFolderBadge() {
    const folderBadge = document.getElementById('folderStatusBadge');
    const folderDot = document.getElementById('folderDot');
    const folderLabel = document.getElementById('folderLabel');
    const btnOpenFolder = document.getElementById('btnOpenFolder');

    if (!folderBadge || !folderLabel) return;

    const setState = (state) => {
      folderBadge.classList.toggle('green', state === 'synced');
      folderBadge.classList.toggle('yellow', state === 'readonly');
      if (folderDot) folderDot.classList.toggle('synced', state === 'synced');
      if (btnOpenFolder) btnOpenFolder.classList.toggle('green', state === 'synced');
    };

    if (FsSync.isLiveSync()) {
      const dirName = FsSync.getLinkedDirName();
      const via = FsSync.getMode() === 'agent' ? 'local agent' : 'browser';
      setState('synced');
      folderLabel.textContent = `${dirName} (Synced)`;
      folderBadge.title = `Connected to local folder: ${dirName} (via ${via}). Click to disconnect.`;
    } else if (FsSync.isLinked()) {
      const dirName = FsSync.getLinkedDirName();
      setState('readonly');
      folderLabel.textContent = `${dirName} (Read-only)`;
      folderBadge.title = `Loaded from "${dirName}". This browser cannot write to disk: use Download ZIP to save changes, or run "npm start" for live sync. Click to disconnect.`;
    } else {
      const agent = FsSync.getAgentStatus();
      setState('standalone');
      folderLabel.textContent = 'No folder linked';
      folderBadge.title = agent
        ? `Local agent detected (folder "${agent.dirName}"). Click to connect.`
        : 'Click to select a local folder for live sync';
    }
  }

  async function handleOpenDirectory() {
    try {
      showToast('Opening folder selector...', 'info');
      const result = await FsSync.selectDirectory();
      replaceBoard(result.tasks, result.tags);
      Storage.saveLocalTasks(tasks);
      markClean();
      updateFolderBadge();
      Board.renderBoard();
      window.VG.TaskPage.onTasksReplaced();
      showToast(`Loaded ${tasks.length} tasks and ${result.attachmentCount} attachments from "${result.dirName}"`, 'success');
      if (result.mode === 'snapshot') {
        showToast('Read-only: this browser cannot write to folders. Use Download ZIP to save changes, or run "npm start" for live sync.', 'warning', 8000);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        UI.alert(err.message, { title: 'Could not open folder' });
      }
    }
  }

  async function handleDownloadZip() {
    if (!tasks || tasks.length === 0) {
      showToast('Board is empty. Create a task or upload files first.', 'warning');
      return;
    }

    try {
      showToast('Building ZIP archive...', 'info');
      const res = await ZipManager.exportTasksZip(tasks, 'tasks.zip');
      markClean();
      showToast(`Downloaded tasks.zip (${res.taskCount} tasks, ${res.attachmentCount} attachments)`, 'success');
    } catch (err) {
      UI.alert(err.message, { title: 'Could not create the ZIP archive' });
    }
  }

  async function handleUploadFile(file) {
    if (!file) return;

    const lowerName = file.name.toLowerCase();

    // 1. ZIP File
    if (lowerName.endsWith('.zip') || file.type === 'application/zip') {
      try {
        showToast(`Extracting ${file.name}...`, 'info');
        const res = await ZipManager.importTasksZip(file);
        replaceBoard(res.tasks, res.tags);
        Storage.saveLocalTasks(tasks);
        markClean();
        Board.renderBoard();
        window.VG.TaskPage.onTasksReplaced();
        showToast(`Imported ${tasks.length} tasks and ${res.attachmentCount} attachments from ${file.name}`, 'success');
      } catch (err) {
        UI.alert(err.message, { title: `Could not import "${file.name}"` });
      }
      return;
    }

    // 2. JSON File
    if (lowerName.endsWith('.json') || file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const validation = Validation.validateTasksJson(parsed);
          if (!validation.valid) {
            UI.alert(validation.error, { title: `"${file.name}" has an invalid tasks format` });
            return;
          }

          replaceBoard(Validation.normalizeTasks(validation.list), validation.tags);
          Storage.saveLocalTasks(tasks);
          markClean();
          Board.renderBoard();
          window.VG.TaskPage.onTasksReplaced();
          showToast(`Loaded ${tasks.length} tasks from ${file.name}`, 'success');
        } catch (err) {
          UI.alert(err.message, { title: `Invalid JSON file "${file.name}"` });
        }
      };
      reader.readAsText(file);
      return;
    }

    showToast(`Unsupported file type: ${file.name}. Please upload a .json or .zip file.`, 'warning');
  }

  async function handleClearBoard() {
    if (!tasks || tasks.length === 0) {
      showToast('Board is already empty', 'info');
      return;
    }

    const ok = await UI.confirm(
      `Clear all ${tasks.length} tasks from the board?\n\nTip: use "Download ZIP" first if you want to keep a complete backup.`,
      { title: 'Clear board', okText: 'Clear board', danger: true }
    );
    if (ok) {
      replaceBoard([], []);
      Storage.clearLocalTasks();
      await Storage.clearAttachmentsIfSoleTab();
      FsSync.unlink();
      markClean();
      updateFolderBadge();
      Board.renderBoard();
      window.VG.TaskPage.onTasksReplaced();
      showToast('Board cleared', 'info');
    }
  }

  function handleDownloadJson() {
    if (!tasks || tasks.length === 0) {
      showToast('Board is empty. Create a task or upload files first.', 'warning');
      return;
    }
    const blob = new Blob([JSON.stringify(buildDocument(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasks.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    markClean();
    showToast(`Downloaded tasks.json (${tasks.length} tasks)`, 'success');
  }

  function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const priorityFilter = document.getElementById('priorityFilter');
    const btnNewTask = document.getElementById('btnNewTask');
    const btnOpenFolder = document.getElementById('btnOpenFolder');
    const btnUpload = document.getElementById('btnUpload');
    const btnDownloadZip = document.getElementById('btnDownloadZip');
    const btnDownloadJson = document.getElementById('btnDownloadJson');
    const btnClearBoard = document.getElementById('btnClearBoard');
    const fileInputPicker = document.getElementById('fileInputPicker');
    const folderStatusBadge = document.getElementById('folderStatusBadge');

    if (searchInput) searchInput.addEventListener('input', () => Board.renderBoard());
    if (priorityFilter) priorityFilter.addEventListener('change', () => Board.renderBoard());
    const tagFilter = document.getElementById('tagFilter');
    if (tagFilter) tagFilter.addEventListener('change', () => Board.renderBoard());

    if (btnNewTask) {
      btnNewTask.addEventListener('click', () => Modals.openCreateModal('planned'));
    }

    if (btnOpenFolder) {
      btnOpenFolder.addEventListener('click', handleOpenDirectory);
    }

    if (folderStatusBadge) {
      const onBadgeActivate = async () => {
        if (FsSync.isLinked()) {
          if (await UI.confirm(`Disconnect folder "${FsSync.getLinkedDirName()}"?`, { title: 'Disconnect folder', okText: 'Disconnect' })) {
            FsSync.unlink();
            updateFolderBadge();
            showToast('Disconnected from folder', 'info');
          }
        } else {
          handleOpenDirectory();
        }
      };
      folderStatusBadge.addEventListener('click', onBadgeActivate);
      folderStatusBadge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onBadgeActivate();
        }
      });
    }

    // Download menu (ZIP / JSON)
    window.jQuery('#downloadMenu').dropdown({ action: 'hide' });

    if (btnUpload && fileInputPicker) {
      btnUpload.addEventListener('click', () => fileInputPicker.click());
      fileInputPicker.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleUploadFile(e.target.files[0]);
          fileInputPicker.value = '';
        }
      });
    }

    if (btnDownloadZip) {
      btnDownloadZip.addEventListener('click', handleDownloadZip);
    }

    if (btnDownloadJson) {
      btnDownloadJson.addEventListener('click', handleDownloadJson);
    }

    if (btnClearBoard) {
      btnClearBoard.addEventListener('click', handleClearBoard);
    }

    // Keyboard shortcuts: Escape closes modals, "/" focuses search, "n" creates a task
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.activeElement === searchInput && searchInput.value) {
          searchInput.value = '';
          Board.renderBoard();
          return;
        }
        Modals.closeCreateModal();
        Modals.closeEditModal();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey || Modals.isAnyModalOpen()) return;
      if (window.VG.TaskPage.isOpen() && e.key === '/') return;
      const target = e.target;
      const isTyping = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (isTyping) return;

      if (e.key === '/' && searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        Modals.openCreateModal('planned');
      }
    });

    // Warn before leaving when changes only live in this tab: the board
    // starts empty on every visit, so they would be lost.
    window.addEventListener('beforeunload', (e) => {
      if ((hasUnsavedChanges && !FsSync.isLiveSync()) || window.VG.TaskPage.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Drag and drop JSON or ZIP files directly onto the browser window
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.json') || lower.endsWith('.zip') || file.type === 'application/zip') {
          e.preventDefault();
          handleUploadFile(file);
        }
      }
    });
  }

  async function initApp() {
    // 1. Initialize IndexedDB
    await Storage.initDb();
    await Storage.registerTab();

    // 2. Setup modals and the task page
    Modals.initModals();
    window.VG.TaskPage.init();

    // 3. Render column drop zones
    Board.renderBoardColumns();

    // 4. Setup toolbar and drag/drop listeners
    setupEventListeners();

    // 5. Always start with a clean empty board on page entry
    replaceBoard([], []);

    // Clear any stale cached tasks from earlier localStorage, and the attachment
    // blobs of previous visits (nothing references them on an empty board)
    Storage.clearLocalTasks();
    await Storage.clearAttachmentsIfSoleTab();

    // 6. Update UI
    updateFolderBadge();
    Board.renderBoard();

    // A #/task/<id> link cannot resolve on an empty board: route() explains and
    // falls back to the board
    if (window.location.hash) window.VG.TaskPage.route();

    // 7. Detect a running local sync agent (server.js) for browsers without
    //    the File System Access API (Safari, Firefox)
    FsSync.probeAgent().then(updateFolderBadge);
  }

  window.VG.App = {
    initApp,
    getTasks,
    setTasks,
    replaceBoard,
    buildDocument,
    refreshTagFilter,
    persistChanges,
    showToast,
    updateFolderBadge
  };

  document.addEventListener('DOMContentLoaded', initApp);
})();
