/**
 * vg-task-manager: Main Application Orchestrator (MongoDB Atlas Backend)
 */
(function() {
  window.VG = window.VG || {};
  const Storage = window.VG.Storage;
  const Validation = window.VG.Validation;
  const MongoSync = window.VG.MongoSync;
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

  /** Replaces the whole board with its tag registry */
  function replaceBoard(newTasks, rawTags = []) {
    tasks = newTasks || [];
    Tags.load(rawTags, tasks);
    refreshTagFilter();
    if (window.VG.Board && window.VG.Board.clearSelection) {
      window.VG.Board.clearSelection();
    }
  }

  /** The board document: tag registry + tasks */
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

  let hasUnsavedChanges = false;

  function markDirty() {
    hasUnsavedChanges = tasks.length > 0;
  }

  function markClean() {
    hasUnsavedChanges = false;
  }

  function persistChanges(notifyMessage = 'Saved') {
    refreshTagFilter();

    if (MongoSync && MongoSync.isConnected()) {
      MongoSync.saveTasks(buildDocument()).then(saved => {
        if (!saved) {
          markDirty();
          showToast('Could not save changes to MongoDB Atlas', 'error', 7000);
        } else {
          markClean();
          if (notifyMessage) {
            showToast(`${notifyMessage} & synced to MongoDB`, 'success');
          }
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

  function updateMongoBadge() {
    const btnMongoStatus = document.getElementById('btnMongoStatus');
    const mongoStatusDot = document.getElementById('mongoStatusDot');
    const mongoStatusLabel = document.getElementById('mongoStatusLabel');
    const mongoEmptyState = document.getElementById('mongoEmptyState');
    const kanbanBoard = document.getElementById('kanbanBoard');
    const priorityFilter = document.getElementById('priorityFilter');
    const tagFilter = document.getElementById('tagFilter');
    const searchInput = document.getElementById('searchInput');

    if (!btnMongoStatus || !mongoStatusLabel) return;

    const isConnected = MongoSync && MongoSync.isConnected();

    if (isConnected) {
      btnMongoStatus.classList.add('green');
      btnMongoStatus.classList.remove('orange');
      if (mongoStatusDot) {
        mongoStatusDot.className = 'status-dot synced';
      }
      const dbName = MongoSync.getCurrentDb() || 'vg-task-manager';
      mongoStatusLabel.textContent = `MongoDB: ${dbName} (${tasks.length})`;
      btnMongoStatus.title = `Connected to database "${dbName}". Click to manage connection or disconnect.`;

      if (mongoEmptyState) mongoEmptyState.style.display = 'none';
      if (kanbanBoard) kanbanBoard.style.display = 'flex';
      if (priorityFilter) priorityFilter.disabled = false;
      if (searchInput) searchInput.disabled = false;
    } else {
      btnMongoStatus.classList.remove('green');
      btnMongoStatus.classList.add('orange');
      if (mongoStatusDot) {
        mongoStatusDot.className = 'status-dot disconnected';
      }
      mongoStatusLabel.textContent = 'Connect MongoDB';
      btnMongoStatus.title = 'Click to enter your MongoDB connection string';

      if (mongoEmptyState) mongoEmptyState.style.display = 'block';
      if (kanbanBoard) kanbanBoard.style.display = 'none';
      if (priorityFilter) priorityFilter.disabled = true;
      if (searchInput) searchInput.disabled = true;
    }
  }

  async function loadFromMongo() {
    try {
      showToast('Loading tasks from MongoDB Atlas...', 'info');
      const data = await MongoSync.loadTasks();
      const validation = Validation.validateTasksJson(data);
      if (!validation.valid) {
        throw new Error('Data format error from MongoDB: ' + validation.error);
      }
      const normalizedTasks = Validation.normalizeTasks(validation.list);
      replaceBoard(normalizedTasks, validation.tags);
      markClean();
      updateMongoBadge();
      Board.renderBoard();
      window.VG.TaskPage.onTasksReplaced();
      showToast(`Loaded ${normalizedTasks.length} tasks from MongoDB Atlas`, 'success');
      return true;
    } catch (err) {
      UI.alert(err.message, { title: 'Could not load tasks from MongoDB' });
      return false;
    }
  }

  function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const priorityFilter = document.getElementById('priorityFilter');
    const btnNewTask = document.getElementById('btnNewTask');
    const btnMongoStatus = document.getElementById('btnMongoStatus');
    const btnConnectEmptyState = document.getElementById('btnConnectEmptyState');
    const tagFilter = document.getElementById('tagFilter');

    if (searchInput) searchInput.addEventListener('input', () => Board.renderBoard());
    if (priorityFilter) priorityFilter.addEventListener('change', () => Board.renderBoard());
    if (tagFilter) tagFilter.addEventListener('change', () => Board.renderBoard());

    if (btnNewTask) {
      btnNewTask.addEventListener('click', () => {
        if (!MongoSync.isConnected()) {
          showToast('Please connect to MongoDB first', 'warning');
          Modals.openMongoModal();
          return;
        }
        Modals.openCreateModal('planned');
      });
    }

    if (btnMongoStatus) {
      btnMongoStatus.addEventListener('click', () => Modals.openMongoModal());
    }

    if (btnConnectEmptyState) {
      btnConnectEmptyState.addEventListener('click', () => Modals.openMongoModal());
    }

    // Bulk Tag buttons and toolbar
    const btnBulkTag = document.getElementById('btnBulkTag');
    const btnBulkBarTag = document.getElementById('btnBulkBarTag');
    const btnBulkBarSelectVisible = document.getElementById('btnBulkBarSelectVisible');
    const btnBulkBarClear = document.getElementById('btnBulkBarClear');
    const btnBulkBarClose = document.getElementById('btnBulkBarClose');

    if (btnBulkTag) {
      btnBulkTag.addEventListener('click', () => {
        if (!MongoSync.isConnected()) {
          Modals.openMongoModal();
          return;
        }
        Board.openBulkTagDialog();
      });
    }
    if (btnBulkBarTag) {
      btnBulkBarTag.addEventListener('click', () => Board.openBulkTagDialog());
    }
    if (btnBulkBarSelectVisible) {
      btnBulkBarSelectVisible.addEventListener('click', () => Board.selectAllVisible());
    }
    if (btnBulkBarClear) {
      btnBulkBarClear.addEventListener('click', () => Board.clearSelection());
    }
    if (btnBulkBarClose) {
      btnBulkBarClose.addEventListener('click', () => Board.clearSelection());
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (Board && Board.getSelectedTaskIds && Board.getSelectedTaskIds().length > 0) {
          Board.clearSelection();
          return;
        }
        if (document.activeElement === searchInput && searchInput.value) {
          searchInput.value = '';
          Board.renderBoard();
          return;
        }
        Modals.closeCreateModal();
        Modals.closeEditModal();
        Modals.closeMongoModal();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey || Modals.isAnyModalOpen()) return;
      if (window.VG.TaskPage.isOpen() && (e.key === '/' || e.key === 't' || e.key === 'T')) return;
      const target = e.target;
      const isTyping = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (isTyping) return;

      if (e.key === '/' && searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (!MongoSync.isConnected()) {
          Modals.openMongoModal();
        } else {
          Modals.openCreateModal('planned');
        }
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        if (!MongoSync.isConnected()) {
          Modals.openMongoModal();
        } else {
          Board.openBulkTagDialog();
        }
      }
    });

    // Warn before leaving if unsaved changes exist
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedChanges || window.VG.TaskPage.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function initApp() {
    // 1. Initialize IndexedDB
    await Storage.initDb();
    await Storage.registerTab();

    // 2. Setup modals and task page
    Modals.initModals();
    window.VG.TaskPage.init();

    // 3. Render column drop zones
    Board.renderBoardColumns();

    // 4. Setup listeners
    setupEventListeners();

    // 5. Start with empty board - NO tasks visible until MongoDB connection is provided
    replaceBoard([], []);
    Storage.clearLocalTasks();

    // 6. Check if MongoDB is already connected on backend
    const status = await MongoSync.checkStatus();

    // 7. Update UI
    updateMongoBadge();
    Board.renderBoard();

    // 8. If already connected on backend, load tasks automatically
    if (status && status.connected) {
      await loadFromMongo();
    } else {
      // Not connected: automatically open the MongoDB connection modal
      // so the user can enter the connection string immediately
      setTimeout(() => {
        Modals.openMongoModal();
      }, 350);
    }
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
    updateMongoBadge,
    loadFromMongo
  };

  document.addEventListener('DOMContentLoaded', initApp);
})();
