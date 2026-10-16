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

  let tasks = [];

  function getTasks() {
    return tasks;
  }

  function setTasks(newTasks) {
    tasks = newTasks || [];
  }

  function persistChanges(notifyMessage = 'Saved') {
    Storage.saveLocalTasks(tasks);

    // If local folder is connected, save directly to tasks.json on disk ("sincronia")
    if (FsSync.isLinked()) {
      FsSync.saveTasksToDirectory(tasks).then(saved => {
        if (saved && notifyMessage) {
          showToast(`${notifyMessage} & synced to folder`, 'success');
        }
      }).catch(err => {
        console.warn('Could not sync to local folder:', err);
      });
      return;
    }

    if (notifyMessage) {
      showToast(notifyMessage, 'info');
    }
  }

  function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function updateFolderBadge() {
    const folderBadge = document.getElementById('folderStatusBadge');
    const folderDot = document.getElementById('folderDot');
    const folderLabel = document.getElementById('folderLabel');
    const btnOpenFolder = document.getElementById('btnOpenFolder');

    if (!folderBadge || !folderLabel) return;

    if (FsSync.isLinked()) {
      const dirName = FsSync.getLinkedDirName();
      if (folderDot) folderDot.classList.add('synced');
      folderLabel.textContent = `📁 ${dirName} (Synced)`;
      folderBadge.title = `Connected to local folder: ${dirName}. Click to disconnect.`;
      if (btnOpenFolder) btnOpenFolder.classList.add('btn-folder-linked');
    } else {
      if (folderDot) folderDot.classList.remove('synced');
      folderLabel.textContent = 'Standalone (No folder linked)';
      folderBadge.title = 'Click to select a local folder for live sync';
      if (btnOpenFolder) btnOpenFolder.classList.remove('btn-folder-linked');
    }
  }

  async function handleOpenDirectory() {
    try {
      showToast('Opening folder selector...', 'info');
      const result = await FsSync.selectDirectory();
      tasks = result.tasks;
      Storage.saveLocalTasks(tasks);
      updateFolderBadge();
      Board.renderBoard();
      showToast(`Loaded ${tasks.length} tasks and ${result.attachmentCount} attachments from "${result.dirName}"`, 'success');
    } catch (err) {
      if (err.name !== 'AbortError') {
        alert('Could not open folder:\n\n' + err.message);
        showToast('Folder selection cancelled or failed', 'error');
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
      showToast(`Downloaded tasks.zip (${res.taskCount} tasks, ${res.attachmentCount} attachments)`, 'success');
    } catch (err) {
      alert('Error creating ZIP archive: ' + err.message);
      showToast('Export error: ' + err.message, 'error');
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
        tasks = res.tasks;
        Storage.saveLocalTasks(tasks);
        Board.renderBoard();
        showToast(`Imported ${tasks.length} tasks and ${res.attachmentCount} attachments from ${file.name}`, 'success');
      } catch (err) {
        alert(`Failed to import ZIP file "${file.name}":\n\n${err.message}`);
        showToast('ZIP import failed: ' + err.message, 'error');
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
            alert(`Upload rejected: "${file.name}" has an invalid tasks format.\n\n${validation.error}`);
            showToast('Validation error: ' + validation.error, 'error');
            return;
          }

          tasks = Validation.normalizeTasks(validation.list);
          Storage.saveLocalTasks(tasks);
          Board.renderBoard();
          showToast(`Loaded ${tasks.length} tasks from ${file.name}`, 'success');
        } catch (err) {
          alert(`Invalid JSON file "${file.name}":\n\n${err.message}`);
          showToast('JSON parse error: ' + err.message, 'error');
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

    if (confirm(`Clear all ${tasks.length} tasks from the board?\n\nTip: You can click "Download ZIP" before clearing if you want to keep a complete backup.`)) {
      tasks = [];
      Storage.clearLocalTasks();
      await Storage.clearAllAttachments();
      FsSync.unlink();
      updateFolderBadge();
      Board.renderBoard();
      showToast('Board cleared', 'info');
    }
  }

  function handleDownloadJson() {
    if (!tasks || tasks.length === 0) {
      showToast('Board is empty. Create a task or upload files first.', 'warning');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = 'tasks.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
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

    if (btnNewTask) {
      btnNewTask.addEventListener('click', () => Modals.openCreateModal('planned'));
    }

    if (btnOpenFolder) {
      btnOpenFolder.addEventListener('click', handleOpenDirectory);
    }

    if (folderStatusBadge) {
      folderStatusBadge.addEventListener('click', () => {
        if (FsSync.isLinked()) {
          if (confirm(`Disconnect folder "${FsSync.getLinkedDirName()}" from live sync?`)) {
            FsSync.unlink();
            updateFolderBadge();
            showToast('Disconnected from folder', 'info');
          }
        } else {
          handleOpenDirectory();
        }
      });
    }

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

    // Escape key closes modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        Modals.closeCreateModal();
        Modals.closeEditModal();
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

    // 2. Setup modals
    Modals.initModals();

    // 3. Render column drop zones
    Board.renderBoardColumns();

    // 4. Setup toolbar and drag/drop listeners
    setupEventListeners();

    // 5. Always start with a clean empty board on page entry
    tasks = [];

    // Clear any stale cached tasks from earlier localStorage
    Storage.clearLocalTasks();

    // 6. Update UI
    updateFolderBadge();
    Board.renderBoard();
  }

  window.VG.App = {
    initApp,
    getTasks,
    setTasks,
    persistChanges,
    showToast,
    updateFolderBadge
  };

  document.addEventListener('DOMContentLoaded', initApp);
})();
