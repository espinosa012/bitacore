/**
 * bitacore: Tag Explorer Controller
 * Manages the tag explorer view, live search, tag inspection, and task list rendering.
 */
(function() {
  window.VG = window.VG || {};

  const Constants = window.VG.Constants || {};
  const escapeHtml = Constants.escapeHtml || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const canonicalState = Constants.canonicalState || (s => s || 'planned');
  const canonicalPriority = Constants.canonicalPriority || (s => s || 'medium');
  const canonicalTaskType = Constants.canonicalTaskType || (s => s || 'task');
  const STATES = Constants.STATES || [];
  const PRIORITIES = Constants.PRIORITIES || {};
  const TASK_TYPES = Constants.TASK_TYPES || {};

  let selectedTag = null;
  let searchQuery = '';
  let initialized = false;

  function el(id) {
    return document.getElementById(id);
  }

  function isOpen() {
    const view = el('tagExplorerView');
    return view && !view.hidden && view.style.display !== 'none';
  }

  function getTagsUsage() {
    const tasks = window.VG.App ? window.VG.App.getTasks() : [];
    if (!window.VG.Tags) return [];
    const list = window.VG.Tags.usage(tasks);
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  function getTasksForTag(tagName) {
    if (!tagName) return [];
    const lower = String(tagName).trim().toLowerCase();
    const tasks = window.VG.App ? window.VG.App.getTasks() : [];
    return tasks.filter(task => {
      const tags = task.tags || [];
      return tags.some(t => String(t).trim().toLowerCase() === lower);
    });
  }

  function renderTagList() {
    const listContainer = el('tagExplorerItemsList');
    const totalBadge = el('tagExplorerTotalBadge');
    const filterCount = el('tagExplorerFilterCount');
    const noTagsMsg = el('tagExplorerNoTags');

    if (!listContainer) return;

    const allTags = getTagsUsage();
    if (totalBadge) totalBadge.textContent = allTags.length;

    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? allTags.filter(t => t.name.toLowerCase().includes(query))
      : allTags;

    if (filterCount) {
      if (allTags.length === 0) {
        filterCount.textContent = 'No tags in project';
      } else if (query) {
        filterCount.textContent = `Showing ${filtered.length} of ${allTags.length} tags`;
      } else {
        filterCount.textContent = `All ${allTags.length} tags`;
      }
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = '';
      if (noTagsMsg) {
        noTagsMsg.style.display = 'flex';
        noTagsMsg.innerHTML = allTags.length === 0
          ? '<i class="tags icon" style="font-size: 2rem; color: #718096; margin-bottom: 0.5rem;"></i><div>No tags in this project yet</div>'
          : '<i class="search icon" style="font-size: 2rem; color: #718096; margin-bottom: 0.5rem;"></i><div>No matching tags found</div>';
      }
      return;
    }

    if (noTagsMsg) noTagsMsg.style.display = 'none';

    listContainer.innerHTML = filtered.map(tag => {
      const isSelected = selectedTag && selectedTag.toLowerCase() === tag.name.toLowerCase();
      const color = tag.color || 'grey';
      return `
        <button type="button" class="tag-item-btn ${isSelected ? 'active' : ''}" data-tag-name="${escapeHtml(tag.name)}" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
          <div class="tag-item-left">
            <span class="ui empty circular mini ${escapeHtml(color)} label"></span>
            <span class="tag-item-name" title="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</span>
          </div>
          <span class="ui circular mini grey label tag-item-badge">${tag.count}</span>
        </button>
      `;
    }).join('');
  }

  function renderSelectedTagTasks() {
    const noSelection = el('tagExplorerNoSelectionState');
    const container = el('tagExplorerSelectedContainer');
    const badge = el('tagExplorerSelectedBadge');
    const nameEl = el('tagExplorerSelectedName');
    const countEl = el('tagExplorerSelectedCount');
    const tasksList = el('tagExplorerTasksList');
    const tasksEmpty = el('tagExplorerTasksEmpty');

    if (!container) return;

    if (!selectedTag) {
      if (noSelection) noSelection.style.display = 'block';
      container.style.display = 'none';
      return;
    }

    if (noSelection) noSelection.style.display = 'none';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';

    const tagColor = window.VG.Tags ? window.VG.Tags.colorOf(selectedTag) : 'grey';
    if (badge) {
      badge.className = `ui large ${tagColor} label tag-selected-badge`;
    }
    if (nameEl) nameEl.textContent = selectedTag;

    const tasks = getTasksForTag(selectedTag);
    if (countEl) {
      countEl.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    }

    if (tasks.length === 0) {
      if (tasksList) tasksList.innerHTML = '';
      if (tasksEmpty) tasksEmpty.style.display = 'block';
      return;
    }

    if (tasksEmpty) tasksEmpty.style.display = 'none';

    if (tasksList) {
      tasksList.innerHTML = tasks.map(task => {
        const stateKey = canonicalState(task.status);
        const stateObj = STATES.find(s => s.id === stateKey) || { label: stateKey, color: 'grey', icon: 'circle' };

        const priorityKey = canonicalPriority(task.priority);
        const priorityObj = PRIORITIES[priorityKey] || { label: priorityKey, color: 'grey', icon: 'circle' };

        const typeKey = canonicalTaskType(task.type);
        const typeObj = TASK_TYPES[typeKey] || { label: typeKey, color: 'blue', icon: 'check square outline' };

        const otherTags = (task.tags || []).filter(t => t.toLowerCase() !== selectedTag.toLowerCase());
        const otherTagsHtml = otherTags.length > 0 && window.VG.Tags
          ? `<div class="tag-task-card-tags">${window.VG.Tags.renderLabels(otherTags, { size: 'mini' })}</div>`
          : '';

        const assigneeHtml = task.assignee
          ? `<span class="tag-task-card-assignee"><i class="user outline icon"></i>${escapeHtml(task.assignee)}</span>`
          : `<span class="tag-task-card-assignee" style="color: #718096;"><i class="user outline icon"></i>Unassigned</span>`;

        return `
          <div class="tag-task-card" data-task-id="${escapeHtml(task.id)}" role="button" tabindex="0" title="Click to open task details">
            <div class="tag-task-card-top">
              <div class="tag-task-card-meta">
                <span class="ui mini basic ${typeObj.color || 'blue'} label">
                  <i class="${escapeHtml(typeObj.icon)} icon"></i>${escapeHtml(typeObj.label)}
                </span>
                <span class="ui mini ${stateObj.color || 'grey'} label">
                  <i class="${escapeHtml(stateObj.icon)} icon"></i>${escapeHtml(stateObj.label)}
                </span>
                <span class="ui mini basic ${priorityObj.color || 'grey'} label">
                  <i class="${escapeHtml(priorityObj.icon)} icon"></i>${escapeHtml(priorityObj.label)}
                </span>
              </div>
            </div>
            <div class="tag-task-card-title">${escapeHtml(task.name || 'Untitled task')}</div>
            <div class="tag-task-card-footer">
              ${assigneeHtml}
              ${otherTagsHtml}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function selectTag(tagName, updateRoute = true) {
    selectedTag = tagName;
    renderTagList();
    renderSelectedTagTasks();

    if (updateRoute && tagName) {
      const targetHash = `#/tags/${encodeURIComponent(tagName)}`;
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, '', targetHash);
      }
    }
  }

  function showTagExplorerView(tagName = null) {
    const explorerView = el('tagExplorerView');
    const kanbanBoard = document.querySelector('main.board-view');
    const adminView = el('adminView');
    const taskPage = el('taskPage');
    const btnExplorer = el('btnOpenTagExplorer');
    const btnExplorerText = el('btnTagExplorerText');

    if (taskPage && window.VG.TaskPage && window.VG.TaskPage.isOpen()) {
      window.VG.TaskPage.close();
    }
    if (adminView && window.VG.Admin && window.VG.Admin.showBoardView) {
      adminView.hidden = true;
      adminView.style.display = 'none';
      const btnAdmin = el('btnOpenAdminPanel');
      if (btnAdmin) btnAdmin.classList.remove('active');
    }

    if (kanbanBoard) kanbanBoard.style.display = 'none';

    document.querySelectorAll('.board-only').forEach(item => {
      item.style.display = 'none';
    });

    if (explorerView) {
      explorerView.hidden = false;
      explorerView.style.display = 'flex';
    }

    if (btnExplorer) {
      btnExplorer.classList.add('teal');
      btnExplorer.classList.add('active');
    }
    if (btnExplorerText) {
      btnExplorerText.textContent = 'Tag Explorer';
    }

    // Load initial selection or specified tag
    if (tagName) {
      selectTag(tagName, false);
    } else if (selectedTag) {
      selectTag(selectedTag, false);
    } else {
      renderTagList();
      renderSelectedTagTasks();
    }
  }

  function showBoardView() {
    const explorerView = el('tagExplorerView');
    const kanbanBoard = document.querySelector('main.board-view');
    const btnExplorer = el('btnOpenTagExplorer');

    if (explorerView) {
      explorerView.hidden = true;
      explorerView.style.display = 'none';
    }
    if (kanbanBoard) {
      kanbanBoard.style.display = '';
    }

    document.querySelectorAll('.board-only').forEach(item => {
      item.style.display = '';
    });

    if (btnExplorer) {
      btnExplorer.classList.remove('teal');
      btnExplorer.classList.remove('active');
    }

    if (window.location.hash.startsWith('#/tags')) {
      window.history.pushState(null, '', window.location.pathname + window.location.search);
    }

    if (window.VG.Board && window.VG.Board.renderBoard) {
      window.VG.Board.renderBoard();
    }
  }

  function toggleTagExplorerView() {
    if (isOpen()) {
      showBoardView();
    } else {
      showTagExplorerView();
      if (!window.location.hash.startsWith('#/tags')) {
        window.history.pushState(null, '', '#/tags');
      }
    }
  }

  function refresh() {
    if (isOpen()) {
      renderTagList();
      renderSelectedTagTasks();
    }
  }

  function initListeners() {
    if (initialized) return;
    initialized = true;

    // Search input
    const searchInput = el('tagExplorerSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderTagList();
      });
    }

    // Tag list item clicks (delegation)
    const listContainer = el('tagExplorerItemsList');
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.tag-item-btn');
        if (btn) {
          const tagName = btn.getAttribute('data-tag-name');
          if (tagName) selectTag(tagName, true);
        }
      });
    }

    // Task cards click (delegation)
    const tasksList = el('tagExplorerTasksList');
    if (tasksList) {
      tasksList.addEventListener('click', (e) => {
        const card = e.target.closest('.tag-task-card');
        if (card) {
          const taskId = card.getAttribute('data-task-id');
          if (taskId && window.VG.TaskPage) {
            window.VG.TaskPage.open(taskId);
          }
        }
      });

      tasksList.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const card = e.target.closest('.tag-task-card');
          if (card) {
            e.preventDefault();
            const taskId = card.getAttribute('data-task-id');
            if (taskId && window.VG.TaskPage) {
              window.VG.TaskPage.open(taskId);
            }
          }
        }
      });
    }

    // View on Board button
    const btnViewOnBoard = el('btnTagExplorerViewOnBoard');
    if (btnViewOnBoard) {
      btnViewOnBoard.addEventListener('click', () => {
        if (!selectedTag) return;
        const tagToFilter = selectedTag;
        showBoardView();
        const tagSelect = el('tagFilter');
        if (tagSelect) {
          const opt = [...tagSelect.options].find(o => o.value.toLowerCase() === tagToFilter.toLowerCase());
          if (opt) {
            tagSelect.value = opt.value;
          }
        }
        if (window.VG.Board && window.VG.Board.renderBoard) {
          window.VG.Board.renderBoard();
        }
      });
    }

    // Header button to toggle Tag Explorer
    const btnOpenExplorer = el('btnOpenTagExplorer');
    if (btnOpenExplorer) {
      btnOpenExplorer.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTagExplorerView();
      });
    }

    // Back to Board button in header
    const btnBack = el('btnTagExplorerBackToBoard');
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        showBoardView();
      });
    }

    // Hash routing for #/tags and #/tags/<tagName>
    function tagFromHash() {
      const hash = window.location.hash;
      if (hash === '#/tags' || hash === '#tags') return '';
      if (hash.startsWith('#/tags/')) {
        try {
          return decodeURIComponent(hash.slice('#/tags/'.length));
        } catch (e) {
          return '';
        }
      }
      return null;
    }

    function onHashChange() {
      const tag = tagFromHash();
      if (tag !== null) {
        showTagExplorerView(tag || null);
      } else if (isOpen() && !window.location.hash.startsWith('#/task/')) {
        showBoardView();
      }
    }

    window.addEventListener('hashchange', onHashChange);

    // Route on initial load if starting with #/tags
    const initialTag = tagFromHash();
    if (initialTag !== null) {
      // Delay slightly so tasks have time to load if mongo-sync is initializing
      setTimeout(() => {
        showTagExplorerView(initialTag || null);
      }, 50);
    }
  }

  // Initialize DOM listeners once document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initListeners);
  } else {
    initListeners();
  }

  window.VG.TagExplorer = {
    isOpen,
    showTagExplorerView,
    showBoardView,
    toggleTagExplorerView,
    selectTag,
    refresh,
    getTagsUsage,
    getTasksForTag
  };
})();
