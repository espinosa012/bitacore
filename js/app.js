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
          showToast('Could not save changes to MongoDB', 'error', 7000);
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
    const authEmptyState = document.getElementById('authEmptyState');
    const kanbanBoard = document.getElementById('kanbanBoard');
    const priorityFilter = document.getElementById('priorityFilter');
    const tagFilter = document.getElementById('tagFilter');
    const userFilter = document.getElementById('userFilter');
    const searchInput = document.getElementById('searchInput');
    const headerUserLabel = document.getElementById('headerUserLabel');
    const sessionUserName = document.getElementById('sessionUserName');
    const btnOpenAuth = document.getElementById('btnOpenAuth');

    if (!btnMongoStatus || !mongoStatusLabel) return;

    const isConnected = MongoSync && MongoSync.isConnected();
    const currentUser = window.VG.Auth && window.VG.Auth.getCurrentUser();
    const isLoggedIn = !!currentUser;

    // Update user button in header
    if (headerUserLabel && btnOpenAuth) {
      if (isLoggedIn) {
        headerUserLabel.textContent = currentUser.username;
        btnOpenAuth.classList.add('is-authenticated');
        btnOpenAuth.title = `Logged in as "${currentUser.username}". Click to manage account.`;
        if (sessionUserName) sessionUserName.textContent = currentUser.username;
      } else {
        headerUserLabel.textContent = 'Log In';
        btnOpenAuth.classList.remove('is-authenticated');
        btnOpenAuth.title = 'Click to log in or register';
        if (sessionUserName) sessionUserName.textContent = 'Guest';
      }
    }

    if (isConnected) {
      btnMongoStatus.classList.add('green');
      btnMongoStatus.classList.remove('orange');
      if (mongoStatusDot) {
        mongoStatusDot.className = 'status-dot synced';
      }
      const dbName = MongoSync.getCurrentDb() || 'vg-task-manager';
      mongoStatusLabel.textContent = `Proxy: ${dbName}${isLoggedIn ? ` (${tasks.length})` : ''}`;
      btnMongoStatus.title = `Connected to database "${dbName}" via vg-mongo-proxy. Click to manage connection or disconnect.`;

      if (mongoEmptyState) mongoEmptyState.style.display = 'none';

      if (isLoggedIn) {
        if (authEmptyState) authEmptyState.style.display = 'none';
        if (kanbanBoard) kanbanBoard.style.display = 'flex';
        if (priorityFilter) priorityFilter.disabled = false;
        const typeFilter = document.getElementById('typeFilter');
        if (typeFilter) typeFilter.disabled = false;
        if (searchInput) searchInput.disabled = false;
        if (userFilter) userFilter.disabled = false;
        const btnFiltersMenu = document.getElementById('btnFiltersMenu');
        if (btnFiltersMenu) btnFiltersMenu.disabled = false;
        const btnFilterFav = document.getElementById('btnFilterFavorite');
        if (btnFilterFav) btnFilterFav.disabled = false;
      } else {
        if (authEmptyState) authEmptyState.style.display = 'block';
        if (kanbanBoard) kanbanBoard.style.display = 'none';
        if (priorityFilter) priorityFilter.disabled = true;
        const typeFilter = document.getElementById('typeFilter');
        if (typeFilter) typeFilter.disabled = true;
        if (searchInput) searchInput.disabled = true;
        if (userFilter) userFilter.disabled = true;
        const btnFiltersMenu = document.getElementById('btnFiltersMenu');
        if (btnFiltersMenu) btnFiltersMenu.disabled = true;
        toggleFiltersPopover(false);
        const btnFilterFav = document.getElementById('btnFilterFavorite');
        if (btnFilterFav) btnFilterFav.disabled = true;
      }
    } else {
      btnMongoStatus.classList.remove('green');
      btnMongoStatus.classList.add('orange');
      if (mongoStatusDot) {
        mongoStatusDot.className = 'status-dot disconnected';
      }
      mongoStatusLabel.textContent = 'Connect Proxy';
      btnMongoStatus.title = 'Click to connect to vg-mongo-proxy';

      if (mongoEmptyState) mongoEmptyState.style.display = 'block';
      if (authEmptyState) authEmptyState.style.display = 'none';
      if (kanbanBoard) kanbanBoard.style.display = 'none';
      if (priorityFilter) priorityFilter.disabled = true;
      const typeFilter = document.getElementById('typeFilter');
      if (typeFilter) typeFilter.disabled = true;
      if (searchInput) searchInput.disabled = true;
      if (userFilter) userFilter.disabled = true;
      const btnFiltersMenu = document.getElementById('btnFiltersMenu');
      if (btnFiltersMenu) btnFiltersMenu.disabled = true;
      toggleFiltersPopover(false);
      const btnFilterFav = document.getElementById('btnFilterFavorite');
      if (btnFilterFav) btnFilterFav.disabled = true;
    }
  }

  /**
   * Position a header popover with fixed coordinates derived from its trigger.
   * The header menu scrolls horizontally (overflow-x: auto), which clips
   * absolutely-positioned children; fixed positioning escapes that clipping.
   */
  function positionHeaderPopover(popover, anchor, align) {
    if (!popover || !anchor) return;
    const gap = 8;
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + gap)}px`;
    const popWidth = popover.offsetWidth;
    let left = align === 'right' ? rect.right - popWidth : rect.left;
    // Keep the popover inside the viewport.
    left = Math.min(Math.max(gap, left), window.innerWidth - popWidth - gap);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.right = 'auto';
  }

  function repositionOpenPopovers() {
    const filtersPopover = document.getElementById('filtersPopover');
    if (filtersPopover && filtersPopover.style.display !== 'none') {
      positionHeaderPopover(filtersPopover, document.getElementById('btnFiltersMenu'), 'left');
    }
    const sessionPopover = document.getElementById('userSessionPopover');
    if (sessionPopover && sessionPopover.style.display !== 'none') {
      positionHeaderPopover(sessionPopover, document.getElementById('btnOpenAuth'), 'right');
    }
  }

  function toggleFiltersPopover(force) {
    const popover = document.getElementById('filtersPopover');
    if (!popover) return;
    const isShowing = popover.style.display !== 'none';
    const show = force !== undefined ? force : !isShowing;
    popover.style.display = show ? 'flex' : 'none';
    if (show) {
      positionHeaderPopover(popover, document.getElementById('btnFiltersMenu'), 'left');
    }
    const btn = document.getElementById('btnFiltersMenu');
    if (btn) {
      btn.setAttribute('aria-expanded', String(show));
      btn.classList.toggle('active', show);
    }
  }

  function toggleUserSessionPopover(force) {
    const popover = document.getElementById('userSessionPopover');
    if (!popover) return;
    const isShowing = popover.style.display !== 'none';
    const show = force !== undefined ? force : !isShowing;
    popover.style.display = show ? 'block' : 'none';
    if (show) {
      positionHeaderPopover(popover, document.getElementById('btnOpenAuth'), 'right');
    }
  }

  function closeAllPopovers() {
    toggleFiltersPopover(false);
    toggleUserSessionPopover(false);
  }

  async function onUserLoggedIn(user) {
    updateMongoBadge();
    const users = await window.VG.Auth.fetchUsers();
    Modals.populateUserDropdowns(users);
    await loadFromMongo();
    showToast(`Welcome back, ${user.username}!`, 'success');
  }

  async function onMongoConnected() {
    updateMongoBadge();
    const users = await window.VG.Auth.fetchUsers();
    Modals.populateUserDropdowns(users);
    const currentUser = window.VG.Auth.getCurrentUser();
    if (currentUser) {
      await loadFromMongo();
    } else {
      updateMongoBadge();
      setTimeout(() => {
        Modals.openAuthModal('login');
      }, 350);
    }
  }

  function logoutUser() {
    window.VG.Auth.logout();
    replaceBoard([], []);
    updateMongoBadge();
    Board.renderBoard();
    showToast('Logged out successfully', 'info');
    setTimeout(() => {
      Modals.openAuthModal('login');
    }, 350);
  }

  async function loadFromMongo() {
    try {
      showToast('Loading tasks from MongoDB...', 'info');
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
      showToast(`Loaded ${normalizedTasks.length} tasks from MongoDB`, 'success');
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
    const btnLoginEmptyState = document.getElementById('btnLoginEmptyState');
    const tagFilter = document.getElementById('tagFilter');
    const userFilter = document.getElementById('userFilter');
    const btnFiltersMenu = document.getElementById('btnFiltersMenu');
    const btnCloseFiltersPopover = document.getElementById('btnCloseFiltersPopover');
    const btnApplyFilters = document.getElementById('btnApplyFilters');
    const btnResetGroupedFilters = document.getElementById('btnResetGroupedFilters');
    const chkCriteriaAssignee = document.getElementById('chkCriteriaAssignee');
    const chkCriteriaCreator = document.getElementById('chkCriteriaCreator');
    const chkCriteriaCommenter = document.getElementById('chkCriteriaCommenter');
    const chkCriteriaUploader = document.getElementById('chkCriteriaUploader');
    const btnCriteriaSelectAll = document.getElementById('btnCriteriaSelectAll');
    const btnCriteriaClear = document.getElementById('btnCriteriaClear');
    const btnOpenAuth = document.getElementById('btnOpenAuth');
    const btnSwitchUser = document.getElementById('btnSwitchUser');
    const btnLogoutUser = document.getElementById('btnLogoutUser');
    const btnClearSearch = document.getElementById('btnClearSearch');
    const searchIcon = document.getElementById('searchIcon');
    const btnClearFilters = document.getElementById('btnClearFilters');

    function updateSearchClearBtn() {
      const hasText = !!(searchInput && searchInput.value && searchInput.value.length > 0);
      if (btnClearSearch) {
        btnClearSearch.style.display = hasText ? 'flex' : 'none';
      }
      if (searchIcon) {
        searchIcon.style.display = hasText ? 'none' : '';
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        updateSearchClearBtn();
        Board.renderBoard();
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });

      btnClearSearch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (searchInput) {
          searchInput.value = '';
          updateSearchClearBtn();
          searchInput.focus();
        }
        Board.renderBoard();
      });
    }

    function clearAllFilters() {
      if (searchInput) searchInput.value = '';
      updateSearchClearBtn();

      if (priorityFilter) priorityFilter.value = 'all';
      const typeFilter = document.getElementById('typeFilter');
      if (typeFilter) typeFilter.value = 'all';
      if (tagFilter) tagFilter.value = 'all';
      if (userFilter) userFilter.value = 'all';

      [chkCriteriaAssignee, chkCriteriaCreator, chkCriteriaCommenter, chkCriteriaUploader].forEach(c => {
        if (c) c.checked = true;
      });

      const userCriteriaBadge = document.getElementById('userCriteriaBadge');
      if (userCriteriaBadge) {
        userCriteriaBadge.innerHTML = '<span class="criteria-label-text">Criteria </span>(4/4)';
      }

      if (Board.setFavoriteFilter) {
        Board.setFavoriteFilter(false);
      }

      if (Board.resetBulkBarDismissed) {
        Board.resetBulkBarDismissed();
      }

      Board.renderBoard();
    }

    window.VG.App.clearAllFilters = clearAllFilters;
    window.VG.App.updateSearchClearBtn = updateSearchClearBtn;

    if (btnClearFilters) {
      btnClearFilters.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllFilters();
      });
    }

    const btnFilterFavorite = document.getElementById('btnFilterFavorite');
    if (btnFilterFavorite) {
      btnFilterFavorite.addEventListener('click', (e) => {
        e.preventDefault();
        if (Board.toggleFavoriteFilter) {
          Board.toggleFavoriteFilter();
        }
      });
    }

    if (priorityFilter) priorityFilter.addEventListener('change', () => Board.renderBoard());
    const typeFilterEl = document.getElementById('typeFilter');
    if (typeFilterEl) typeFilterEl.addEventListener('change', () => Board.renderBoard());
    if (tagFilter) tagFilter.addEventListener('change', () => Board.renderBoard());
    if (userFilter) userFilter.addEventListener('change', () => Board.renderBoard());

    if (btnFiltersMenu) {
      btnFiltersMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUserSessionPopover(false);
        toggleFiltersPopover();
      });
    }

    if (btnCloseFiltersPopover) {
      btnCloseFiltersPopover.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFiltersPopover(false);
      });
    }

    if (btnApplyFilters) {
      btnApplyFilters.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFiltersPopover(false);
      });
    }

    if (btnResetGroupedFilters) {
      btnResetGroupedFilters.addEventListener('click', (e) => {
        e.stopPropagation();
        if (priorityFilter) priorityFilter.value = 'all';
        const typeFilter = document.getElementById('typeFilter');
        if (typeFilter) typeFilter.value = 'all';
        if (tagFilter) tagFilter.value = 'all';
        if (userFilter) userFilter.value = 'all';
        [chkCriteriaAssignee, chkCriteriaCreator, chkCriteriaCommenter, chkCriteriaUploader].forEach(c => {
          if (c) c.checked = true;
        });
        const userCriteriaBadge = document.getElementById('userCriteriaBadge');
        if (userCriteriaBadge) {
          userCriteriaBadge.innerHTML = '<span class="criteria-label-text">Criteria </span>(4/4)';
        }
        Board.renderBoard();
      });
    }

    [chkCriteriaAssignee, chkCriteriaCreator, chkCriteriaCommenter, chkCriteriaUploader].forEach(chk => {
      if (chk) chk.addEventListener('change', () => Board.renderBoard());
    });

    if (btnCriteriaSelectAll) {
      btnCriteriaSelectAll.addEventListener('click', (e) => {
        e.stopPropagation();
        [chkCriteriaAssignee, chkCriteriaCreator, chkCriteriaCommenter, chkCriteriaUploader].forEach(c => {
          if (c) c.checked = true;
        });
        Board.renderBoard();
      });
    }

    if (btnCriteriaClear) {
      btnCriteriaClear.addEventListener('click', (e) => {
        e.stopPropagation();
        [chkCriteriaAssignee, chkCriteriaCreator, chkCriteriaCommenter, chkCriteriaUploader].forEach(c => {
          if (c) c.checked = false;
        });
        Board.renderBoard();
      });
    }

    if (btnOpenAuth) {
      btnOpenAuth.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFiltersPopover(false);
        if (!MongoSync.isConnected()) {
          Modals.openMongoModal();
          return;
        }
        if (window.VG.Auth && window.VG.Auth.getCurrentUser()) {
          toggleUserSessionPopover();
        } else {
          Modals.openAuthModal('login');
        }
      });
    }

    if (btnSwitchUser) {
      btnSwitchUser.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllPopovers();
        Modals.openAuthModal('login');
      });
    }

    if (btnLogoutUser) {
      btnLogoutUser.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllPopovers();
        logoutUser();
      });
    }

    if (btnLoginEmptyState) {
      btnLoginEmptyState.addEventListener('click', () => {
        Modals.openAuthModal('login');
      });
    }

    // Keep open popovers anchored when the page or the menu scrolls/resizes.
    window.addEventListener('resize', repositionOpenPopovers);
    window.addEventListener('scroll', repositionOpenPopovers, true);

    // Dismiss popovers when clicking outside
    document.addEventListener('click', (e) => {
      const filtersContainer = document.querySelector('.filters-menu-container');
      const filtersPopover = document.getElementById('filtersPopover');
      if (
        (!filtersContainer || !filtersContainer.contains(e.target)) &&
        (!filtersPopover || !filtersPopover.contains(e.target))
      ) {
        toggleFiltersPopover(false);
      }
      const sessionContainer = document.querySelector('.user-session-container');
      const sessionPopover = document.getElementById('userSessionPopover');
      if (
        (!sessionContainer || !sessionContainer.contains(e.target)) &&
        (!sessionPopover || !sessionPopover.contains(e.target))
      ) {
        toggleUserSessionPopover(false);
      }
    });

    if (btnNewTask) {
      btnNewTask.addEventListener('click', () => {
        if (!MongoSync.isConnected()) {
          showToast('Please connect to MongoDB first', 'warning');
          Modals.openMongoModal();
          return;
        }
        if (!window.VG.Auth || !window.VG.Auth.getCurrentUser()) {
          showToast('Please log in first to create tasks', 'warning');
          Modals.openAuthModal('login');
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

    // Floating bulk actions toolbar
    const btnBulkBarTag = document.getElementById('btnBulkBarTag');
    const btnBulkBarSelectVisible = document.getElementById('btnBulkBarSelectVisible');
    const btnBulkBarClear = document.getElementById('btnBulkBarClear');
    const btnBulkBarClose = document.getElementById('btnBulkBarClose');

    if (btnBulkBarTag) {
      btnBulkBarTag.addEventListener('click', () => {
        if (!MongoSync.isConnected()) {
          Modals.openMongoModal();
          return;
        }
        if (!window.VG.Auth || !window.VG.Auth.getCurrentUser()) {
          Modals.openAuthModal('login');
          return;
        }
        Board.openBulkTagDialog();
      });
    }
    const btnBulkBarFavorite = document.getElementById('btnBulkBarFavorite');
    if (btnBulkBarFavorite) {
      btnBulkBarFavorite.addEventListener('click', () => {
        if (Board.toggleBulkSelectionFavorite) {
          Board.toggleBulkSelectionFavorite();
        }
      });
    }
    if (btnBulkBarSelectVisible) {
      btnBulkBarSelectVisible.addEventListener('click', () => Board.selectAllVisible());
    }
    if (btnBulkBarClear) {
      btnBulkBarClear.addEventListener('click', () => Board.clearSelection());
    }
    if (btnBulkBarClose) {
      btnBulkBarClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        Board.dismissBulkBar();
      });
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllPopovers();
        if (Board && Board.getSelectedTaskIds && Board.getSelectedTaskIds().length > 0) {
          Board.dismissBulkBar();
          return;
        }
        const bulkActionBar = document.getElementById('bulkActionBar');
        if (bulkActionBar && !bulkActionBar.hidden) {
          Board.dismissBulkBar();
          return;
        }
        if (document.activeElement === searchInput && searchInput.value) {
          searchInput.value = '';
          updateSearchClearBtn();
          Board.renderBoard();
          return;
        }
        Modals.closeCreateModal();
        Modals.closeEditModal();
        Modals.closeMongoModal();
        Modals.closeAuthModal();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey || Modals.isAnyModalOpen()) return;
      if (window.VG.TaskPage.isOpen() && (e.key === '/' || e.key === 't' || e.key === 'T' || e.key === 'f' || e.key === 'F')) return;
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
        } else if (!window.VG.Auth || !window.VG.Auth.getCurrentUser()) {
          Modals.openAuthModal('login');
        } else {
          Modals.openCreateModal('planned');
        }
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        if (!MongoSync.isConnected()) {
          Modals.openMongoModal();
        } else if (!window.VG.Auth || !window.VG.Auth.getCurrentUser()) {
          Modals.openAuthModal('login');
        } else {
          Board.openBulkTagDialog();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (Board.toggleFavoriteFilter) {
          Board.toggleFavoriteFilter();
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

    // 5. Start with empty board - NO tasks visible until MongoDB connection and login
    replaceBoard([], []);
    Storage.clearLocalTasks();

    // 6. Check if MongoDB is already connected on backend
    const status = await MongoSync.checkStatus();

    // 7. Update UI
    updateMongoBadge();
    Board.renderBoard();

    // 8. If already connected on backend, check authentication
    if (status && status.connected) {
      const users = await window.VG.Auth.fetchUsers();
      Modals.populateUserDropdowns(users);

      const currentUser = window.VG.Auth.getCurrentUser();
      if (currentUser) {
        await loadFromMongo();
      } else {
        updateMongoBadge();
        setTimeout(() => {
          Modals.openAuthModal('login');
        }, 350);
      }
    } else {
      // Not connected: automatically open the MongoDB connection modal
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
    loadFromMongo,
    onMongoConnected,
    onUserLoggedIn,
    logoutUser
  };

  document.addEventListener('DOMContentLoaded', initApp);
})();
