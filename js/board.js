/**
 * bitacore: Board Rendering & Drag-and-Drop Interaction
 */
(function() {
  window.VG = window.VG || {};
  const { STATES, PRIORITIES, TASK_TYPES, canonicalState, canonicalPriority, canonicalTaskType, formatTaskId, escapeHtml, escapeCss, formatRelativeTime } = window.VG.Constants;
  const Storage = window.VG.Storage;

  let collapsedColumns = Storage.loadCollapsedColumns();
  let draggedTaskId = null;
  let isDragging = false;
  let selectedTaskIds = new Set();
  let visibleTasks = [];
  let bulkBarDismissed = false;
  let filterFavoriteOnly = false;

  const EMPTY_COLUMN_HTML = '<div class="column-empty">No tasks</div>';

  const dropPlaceholder = document.createElement('div');
  dropPlaceholder.className = 'card-drop-placeholder';

  function toggleColumnCollapse(stateId, event) {
    if (event) event.stopPropagation();
    const canonical = canonicalState(stateId);
    if (collapsedColumns.has(canonical)) {
      collapsedColumns.delete(canonical);
    } else {
      collapsedColumns.add(canonical);
    }
    Storage.saveCollapsedColumns(collapsedColumns);
    renderBoardColumns();
    renderBoard();
  }

  function renderBoardColumns() {
    const kanbanBoard = document.getElementById('kanbanBoard');
    if (!kanbanBoard) return;

    kanbanBoard.innerHTML = '';
    const anyCollapsed = STATES.some(st => collapsedColumns.has(st.id));
    kanbanBoard.classList.toggle('has-collapsed-columns', anyCollapsed);
    STATES.forEach(st => {
      const isCollapsed = collapsedColumns.has(st.id);
      const colEl = document.createElement('div');
      colEl.className = `ui inverted segment board-column col-${st.color} ${isCollapsed ? 'collapsed' : ''}`;
      colEl.setAttribute('data-col-state', st.id);
      if (isCollapsed) {
        colEl.setAttribute('title', `${st.label} (Collapsed - Click to expand)`);
      }

      colEl.innerHTML = `
        <div class="column-header">
          <h4 class="ui inverted header column-title">
            <i class="${st.icon} ${st.color} icon"></i>
            <div class="content">${escapeHtml(st.label)}</div>
          </h4>
          <span class="ui circular ${st.color} mini label col-badge" id="badge-${escapeCss(st.id)}">0</span>
          <div class="column-header-actions">
            <button class="ui mini basic inverted icon button col-btn-add" title="Add task to ${escapeHtml(st.label)}" aria-label="Add task to ${escapeHtml(st.label)}">
              <i class="plus icon"></i>
            </button>
            <button class="ui mini basic inverted icon button col-btn-toggle" title="${isCollapsed ? 'Expand column' : 'Collapse column'}" aria-label="${isCollapsed ? 'Expand column' : 'Collapse column'}">
              <i class="${isCollapsed ? 'angle double right' : 'angle double left'} icon"></i>
            </button>
          </div>
        </div>
        <div class="ui one cards column-cards-container" id="col-container-${escapeCss(st.id)}"></div>
      `;

      // Collapse toggle on whole column if collapsed
      colEl.addEventListener('click', (e) => {
        if (colEl.classList.contains('collapsed')) {
          toggleColumnCollapse(st.id, e);
        }
      });

      // Header button handlers
      const addBtn = colEl.querySelector('.col-btn-add');
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.VG.Modals) window.VG.Modals.openCreateModal(st.id);
        });
      }

      const toggleBtn = colEl.querySelector('.col-btn-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          toggleColumnCollapse(st.id, e);
        });
      }

      // Drop zone setup
      setupDropZone(colEl, st.id);

      kanbanBoard.appendChild(colEl);
    });
  }

  function renderBoard() {
    const tasks = window.VG.App ? window.VG.App.getTasks() : [];
    const searchInput = document.getElementById('searchInput');
    const priorityFilter = document.getElementById('priorityFilter');
    const typeFilterEl = document.getElementById('typeFilter');
    const taskStatsCounter = document.getElementById('taskStatsCounter');

    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const prioFilter = priorityFilter ? priorityFilter.value : 'all';
    const typeFilter = typeFilterEl ? typeFilterEl.value : 'all';
    const tagFilterEl = document.getElementById('tagFilter');
    const tagFilter = tagFilterEl && !tagFilterEl.disabled ? tagFilterEl.value : 'all';
    const tagFilterKey = tagFilter.toLowerCase();

    // User filter and checkboxes criteria
    const userFilterEl = document.getElementById('userFilter');
    const userFilter = userFilterEl && !userFilterEl.disabled ? userFilterEl.value : 'all';
    const userFilterKey = userFilter.toLowerCase();

    const chkAssignee = document.getElementById('chkCriteriaAssignee');
    const chkCreator = document.getElementById('chkCriteriaCreator');
    const chkCommenter = document.getElementById('chkCriteriaCommenter');
    const chkUploader = document.getElementById('chkCriteriaUploader');

    const criteria = {
      assignee: !chkAssignee || chkAssignee.checked,
      creator: !chkCreator || chkCreator.checked,
      commenter: !chkCommenter || chkCommenter.checked,
      uploader: !chkUploader || chkUploader.checked
    };

    const criteriaCount = (criteria.assignee ? 1 : 0) + (criteria.creator ? 1 : 0) + (criteria.commenter ? 1 : 0) + (criteria.uploader ? 1 : 0);
    const userCriteriaBadge = document.getElementById('userCriteriaBadge');
    if (userCriteriaBadge) {
      userCriteriaBadge.innerHTML = `<span class="criteria-label-text">Criteria </span>(${criteriaCount}/4)`;
    }

    // Favorite filter and counter badge
    const totalFavorites = tasks.filter(t => t.favorite).length;
    const favCountBadge = document.getElementById('favCountBadge');
    if (favCountBadge) {
      favCountBadge.textContent = totalFavorites;
      favCountBadge.style.display = totalFavorites > 0 ? 'inline-block' : 'none';
    }

    const btnFilterFavorite = document.getElementById('btnFilterFavorite');
    if (btnFilterFavorite) {
      btnFilterFavorite.classList.toggle('active', filterFavoriteOnly);
      btnFilterFavorite.setAttribute('aria-pressed', filterFavoriteOnly ? 'true' : 'false');
      btnFilterFavorite.title = filterFavoriteOnly
        ? 'Showing favorite tasks (Click to show all)'
        : (totalFavorites > 0 ? `Filter favorite tasks (${totalFavorites}) (F)` : 'Filter favorite tasks (F)');
      const starIcon = btnFilterFavorite.querySelector('i.icon');
      if (starIcon) {
        starIcon.className = filterFavoriteOnly ? 'star yellow icon' : 'star outline icon';
      }
    }

    // Clear card containers
    STATES.forEach(st => {
      const container = document.getElementById(`col-container-${escapeCss(st.id)}`);
      if (container) container.innerHTML = '';
    });

    const counts = {
      total: 0,
      shown: 0,
      planned: 0,
      'in progress': 0,
      'in review': 0,
      done: 0,
      blocked: 0
    };

    visibleTasks = [];
    tasks.forEach(t => {
      const st = canonicalState(t.status);
      if (counts[st] !== undefined) {
        counts[st]++;
      }
      counts.total++;

      // Check query match (title, desc, openspec, assignee, reporter, tags, or attachment filenames)
      const matchesAttachment = t.attachments && t.attachments.some(a => 
        a.filename.toLowerCase().includes(query) || (a.name && a.name.toLowerCase().includes(query))
      );

      const matchesQuery = !query || 
        t.name.toLowerCase().includes(query) || 
        t.description.toLowerCase().includes(query) ||
        (t['openspec-id'] && t['openspec-id'].toLowerCase().includes(query)) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(query)) ||
        (t.assignee && t.assignee.toLowerCase().includes(query)) ||
        (t.reporter && t.reporter.toLowerCase().includes(query)) ||
        matchesAttachment;

      const matchesType = typeFilter === 'all' || canonicalTaskType(t.type) === typeFilter;
      const matchesPriority = prioFilter === 'all' || t.priority === prioFilter;
      const matchesTag = tagFilter === 'all' || (t.tags || []).some(tag => tag.toLowerCase() === tagFilterKey);
      const matchesFavorite = !filterFavoriteOnly || Boolean(t.favorite);

      // User filter evaluation against active checkboxes
      let matchesUser = true;
      if (userFilter !== 'all') {
        matchesUser = false;
        if (criteria.assignee && (t.assignee || '').toLowerCase() === userFilterKey) {
          matchesUser = true;
        }
        if (criteria.creator && (t.reporter || '').toLowerCase() === userFilterKey) {
          matchesUser = true;
        }
        if (criteria.commenter && (t.comments || []).some(c => (c.author || '').toLowerCase() === userFilterKey)) {
          matchesUser = true;
        }
        if (criteria.uploader && (t.attachments || []).some(a => (a.uploader || '').toLowerCase() === userFilterKey)) {
          matchesUser = true;
        }
      }

      if (matchesQuery && matchesPriority && matchesTag && matchesUser && matchesFavorite && matchesType) {
        visibleTasks.push(t);
        renderTaskCard(t, query);
        counts.shown++;
      }
    });

    // Prune any selectedTaskIds that are no longer in tasks
    const existingIds = new Set(tasks.map(t => t.id));
    for (const id of selectedTaskIds) {
      if (!existingIds.has(id)) {
        selectedTaskIds.delete(id);
      }
    }

    updateBulkActionUI();

    // Update column badges & empty placeholders
    STATES.forEach(st => {
      const badge = document.getElementById(`badge-${escapeCss(st.id)}`);
      if (badge) badge.textContent = counts[st.id] || 0;

      const container = document.getElementById(`col-container-${escapeCss(st.id)}`);
      if (container && container.children.length === 0) {
        container.innerHTML = EMPTY_COLUMN_HTML;
      }
    });

    const activeFilterCount = (query ? 1 : 0) +
      (typeFilter !== 'all' ? 1 : 0) +
      (prioFilter !== 'all' ? 1 : 0) +
      (tagFilter !== 'all' ? 1 : 0) +
      (userFilter !== 'all' ? 1 : 0) +
      (criteriaCount < 4 ? 1 : 0) +
      (filterFavoriteOnly ? 1 : 0);
    const hasActiveFilter = activeFilterCount > 0;

    const activeGroupedFiltersCount =
      (typeFilter !== 'all' ? 1 : 0) +
      (prioFilter !== 'all' ? 1 : 0) +
      (tagFilter !== 'all' ? 1 : 0) +
      (userFilter !== 'all' ? 1 : 0) +
      (criteriaCount < 4 ? 1 : 0);

    const filtersActiveBadge = document.getElementById('filtersActiveBadge');
    const btnFiltersMenu = document.getElementById('btnFiltersMenu');
    if (filtersActiveBadge) {
      filtersActiveBadge.textContent = String(activeGroupedFiltersCount);
      filtersActiveBadge.style.display = activeGroupedFiltersCount > 0 ? 'inline-block' : 'none';
    }
    if (btnFiltersMenu) {
      btnFiltersMenu.classList.toggle('has-active-filters', activeGroupedFiltersCount > 0);
      btnFiltersMenu.title = activeGroupedFiltersCount > 0
        ? `Filters (${activeGroupedFiltersCount} active)`
        : 'Filter tasks by type, priority, tag, or user';
    }

    // Update board statistics
    if (taskStatsCounter) {
      const shownStr = hasActiveFilter ? ` (${counts.shown} shown)` : '';
      taskStatsCounter.textContent = `${counts.total} tasks${shownStr} · ${counts['in progress']} in progress · ${counts.blocked} blocked`;
    }
    const boardStatsBar = document.getElementById('boardStatsBar');
    const kanbanBoardEl = document.getElementById('kanbanBoard');
    if (boardStatsBar && kanbanBoardEl) {
      boardStatsBar.style.display = kanbanBoardEl.style.display === 'none' ? 'none' : 'flex';
    }

    // Update Clear Filters button
    const btnClearFilters = document.getElementById('btnClearFilters');
    const btnClearFiltersText = document.getElementById('btnClearFiltersText');
    if (btnClearFilters) {
      btnClearFilters.disabled = !hasActiveFilter;
      btnClearFilters.classList.toggle('has-active-filters', hasActiveFilter);
      btnClearFilters.title = hasActiveFilter ? `Clear all applied filters (${activeFilterCount})` : 'No filters applied';
      if (btnClearFiltersText) {
        btnClearFiltersText.textContent = activeFilterCount > 1 ? `Clear Filters (${activeFilterCount})` : 'Clear Filters';
      }
    }

    // Update Search clear button
    const btnClearSearch = document.getElementById('btnClearSearch');
    const searchIcon = document.getElementById('searchIcon');
    if (btnClearSearch) {
      btnClearSearch.style.display = query ? 'flex' : 'none';
    }
    if (searchIcon) {
      searchIcon.style.display = query ? 'none' : '';
    }

    if (window.VG.Overview && window.VG.Overview.refresh) {
      window.VG.Overview.refresh();
    }
  }

  /** Escapes text and wraps case-insensitive matches of query in <mark> */
  function highlight(text, query) {
    const str = String(text || '');
    if (!query) return escapeHtml(str);
    const lower = str.toLowerCase();
    let out = '';
    let pos = 0;
    let idx;
    while ((idx = lower.indexOf(query, pos)) !== -1) {
      out += escapeHtml(str.slice(pos, idx)) + `<mark>${escapeHtml(str.slice(idx, idx + query.length))}</mark>`;
      pos = idx + query.length;
    }
    return out + escapeHtml(str.slice(pos));
  }

  function renderTaskCard(task, query = '') {
    const stId = canonicalState(task.status);
    const colId = escapeCss(stId);
    const container = document.getElementById(`col-container-${colId}`);
    if (!container) return;

    const prioKey = canonicalPriority(task.priority);
    const prioMeta = PRIORITIES[prioKey] || PRIORITIES['medium'];
    const typeKey = canonicalTaskType(task.type);
    const typeMeta = TASK_TYPES[typeKey] || TASK_TYPES['task'] || Object.values(TASK_TYPES)[0] || { label: typeKey, icon: 'tasks', color: 'grey' };

    const allTasks = window.VG.App ? window.VG.App.getTasks() : [];
    const parentTask = task.parentId ? allTasks.find(t => t.id === task.parentId) : null;
    const directSubtasks = allTasks.filter(t => t.parentId === task.id);
    const totalSubtasks = directSubtasks.length;
    const doneSubtasks = directSubtasks.filter(t => canonicalState(t.status) === 'done').length;

    const openSpecId = task['openspec-id'];

    const isSelected = selectedTaskIds.has(task.id);
    const card = document.createElement('div');
    card.className = `ui fluid inverted card task-card prio-${prioKey}${task.favorite ? ' is-favorite' : ''}${isSelected ? ' is-selected' : ''}`;
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${task.name} (${prioMeta.label} priority)${task.favorite ? ' - Favorite' : ''}`);
    card.setAttribute('data-task-id', task.id);

    const commentsCount = task.comments ? task.comments.length : 0;
    const historyCount = task.history ? task.history.length : 0;
    const attachmentsCount = task.attachments ? task.attachments.length : 0;
    const linkedCount = Array.isArray(task.linkedTaskIds) ? task.linkedTaskIds.length : 0;
    const lastUpdateStr = formatRelativeTime(task.updated_at || task.created_at);
    const descText = window.VG.Markdown.toPlainText(task.description);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    card.innerHTML = `
      <div class="content">
        <div class="card-top">
          <input type="checkbox" class="card-select-checkbox" data-task-id="${escapeHtml(task.id)}" ${isSelected ? 'checked' : ''} title="Select task for bulk actions" aria-label="Select task ${escapeHtml(task.name)}" />
          <button type="button" class="card-fav-btn${task.favorite ? ' is-active' : ''}" data-task-id="${escapeHtml(task.id)}" title="${task.favorite ? 'Remove highlight (Favorite)' : 'Highlight task (Favorite)'}" aria-label="${task.favorite ? 'Remove highlight' : 'Highlight task'}">
            <i class="${task.favorite ? 'star' : 'star outline'} icon"></i>
          </button>
          <span class="ui mini ${typeMeta.color} label card-type-badge" title="Type: ${escapeHtml(typeMeta.label)}">
            <i class="${typeMeta.icon} icon"></i>${escapeHtml(typeMeta.label)}
          </span>
          <span class="ui mini ${prioMeta.color} label">
            <i class="${prioMeta.icon} icon"></i>${escapeHtml(prioMeta.label)}
          </span>
          ${parentTask ? `
            <span class="ui mini basic inverted blue label card-parent-badge" style="cursor: pointer;" title="Subtask of #${escapeHtml(formatTaskId(parentTask.id))}: ${escapeHtml(parentTask.name)}">
              <i class="level up alternate icon"></i>#${escapeHtml(formatTaskId(parentTask.id))}
            </span>` : ''}
          ${task.assignee ? `
            <span class="card-assignee" title="Assigned to ${escapeHtml(task.assignee)}">
              <i class="user outline icon"></i>${escapeHtml(task.assignee)}
            </span>` : ''}
          ${openSpecId ? `
            <span class="ui mini basic inverted teal label card-openspec" title="OpenSpec: ${escapeHtml(openSpecId)}">
              <i class="file alternate outline icon"></i>${escapeHtml(openSpecId)}
            </span>` : ''}
          <span class="card-id">#${escapeHtml(formatTaskId(task.id))}</span>
        </div>
        <div class="header card-title">${highlight(task.name, query)}</div>
        ${descText ? `<div class="description card-desc">${highlight(descText, query)}</div>` : ''}
        ${(task.tags || []).length ? `<div class="card-tags">${window.VG.Tags.renderLabels(task.tags, { highlight: (name) => highlight(name, query) })}</div>` : ''}
      </div>
      <div class="extra content card-footer">
        <span class="card-meta">
          ${totalSubtasks > 0 ? `<span class="card-subtask-progress" title="${doneSubtasks} of ${totalSubtasks} subtasks completed" style="color: ${doneSubtasks === totalSubtasks ? '#2ecc40' : '#00b5ad'}; font-weight: 500;"><i class="sitemap icon"></i>${doneSubtasks}/${totalSubtasks} subtasks</span>` : ''}
          ${linkedCount > 0 ? `<span class="card-linked-tasks" title="${plural(linkedCount, 'linked task')}"><i class="linkify icon"></i>${linkedCount}</span>` : ''}
          ${attachmentsCount > 0 ? `<span title="${plural(attachmentsCount, 'attachment')}"><i class="paperclip icon"></i>${attachmentsCount}</span>` : ''}
          ${commentsCount > 0 ? `<span title="${plural(commentsCount, 'comment')}"><i class="comment outline icon"></i>${commentsCount}</span>` : ''}
          <span title="${plural(historyCount, 'transition')}"><i class="history icon"></i>${historyCount}</span>
        </span>
        <span class="card-updated">${lastUpdateStr}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="ui mini icon button card-edit-tags" title="Edit tags" aria-label="Edit tags">
          <i class="tags icon"></i>
        </button>
        <button type="button" class="ui mini icon button card-open-page" title="Open task page" aria-label="Open task page">
          <i class="external alternate icon"></i>
        </button>
      </div>
    `;

    // Checkbox selection listener
    const selectCheckbox = card.querySelector('.card-select-checkbox');
    if (selectCheckbox) {
      selectCheckbox.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      selectCheckbox.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleTaskSelection(task.id, selectCheckbox.checked);
      });
    }

    // Favorite toggle listener
    const favBtn = card.querySelector('.card-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTaskFavorite(task.id);
      });
    }

    // Parent badge click listener
    const parentBadge = card.querySelector('.card-parent-badge');
    if (parentBadge && parentTask) {
      parentBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.VG.Modals) window.VG.Modals.openEditModal(parentTask);
      });
    }

    // Click to edit (the corner button opens the full task page)
    card.addEventListener('click', (e) => {
      if (isDragging) return;
      if (e.target.closest('.card-select-checkbox') || e.target.closest('.card-fav-btn') || e.target.closest('.card-parent-badge')) {
        return;
      }
      if (e.target.closest('.card-open-page')) {
        e.stopPropagation();
        if (window.VG.TaskPage) window.VG.TaskPage.open(task.id);
        return;
      }
      if (e.target.closest('.card-edit-tags')) {
        e.stopPropagation();
        editTaskTags(task);
        return;
      }
      const tagLabel = e.target.closest('.tag-label');
      if (tagLabel) {
        // Clicking a tag filters the board by it
        e.stopPropagation();
        setTagFilter(tagLabel.getAttribute('data-tag'));
        return;
      }
      if (window.VG.Modals) window.VG.Modals.openEditModal(task);
    });

    card.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
        e.preventDefault();
        if (window.VG.Modals) window.VG.Modals.openEditModal(task);
      }
    });

    // Drag start / end
    card.addEventListener('dragstart', (e) => {
      isDragging = true;
      draggedTaskId = task.id;
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      if (dropPlaceholder.parentNode) {
        dropPlaceholder.remove();
      }
      setTimeout(() => {
        isDragging = false;
        draggedTaskId = null;
      }, 50);
    });

    container.appendChild(card);
  }

  function setupDropZone(colElement, stateId) {
    colElement.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const container = colElement.querySelector('.column-cards-container');
      if (!container) return;

      const emptyMsg = container.querySelector('.column-empty');
      if (emptyMsg) emptyMsg.remove();

      const tasks = window.VG.App ? window.VG.App.getTasks() : [];
      const draggedTask = draggedTaskId ? tasks.find(t => t.id === draggedTaskId) : null;
      const isChangingColumn = draggedTask && canonicalState(draggedTask.status) !== canonicalState(stateId);

      if (isChangingColumn) {
        if (container.firstChild !== dropPlaceholder) {
          container.insertBefore(dropPlaceholder, container.firstChild);
        }
      } else {
        const afterElement = getDragAfterElement(container, e.clientY);
        if (afterElement == null) {
          container.appendChild(dropPlaceholder);
        } else {
          container.insertBefore(dropPlaceholder, afterElement);
        }
      }
    });

    colElement.addEventListener('dragleave', (e) => {
      if (!colElement.contains(e.relatedTarget)) {
        const container = colElement.querySelector('.column-cards-container');
        if (container && dropPlaceholder.parentNode === container) {
          dropPlaceholder.remove();
          if (container.children.length === 0) {
            container.innerHTML = EMPTY_COLUMN_HTML;
          }
        }
      }
    });

    colElement.addEventListener('drop', (e) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
      if (!taskId) return;

      const tasks = window.VG.App ? window.VG.App.getTasks() : [];
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex === -1) return;

      const [movedTask] = tasks.splice(taskIndex, 1);
      const prevStatus = movedTask.status;
      const targetState = canonicalState(stateId);
      const isChangingColumn = canonicalState(prevStatus) !== targetState;

      // Determine insert index
      let targetInsertIndex = tasks.length;
      if (isChangingColumn) {
        if (dropPlaceholder.parentNode) {
          dropPlaceholder.remove();
        }
        // When changing column, place it first in that column
        const firstIndexInCol = tasks.findIndex(t => canonicalState(t.status) === targetState);
        targetInsertIndex = firstIndexInCol !== -1 ? firstIndexInCol : 0;
      } else {
        if (dropPlaceholder.parentNode) {
          const nextCard = dropPlaceholder.nextElementSibling;
          dropPlaceholder.remove();

          if (nextCard && nextCard.classList.contains('card')) {
            const nextTaskId = nextCard.getAttribute('data-task-id');
            const nextIndex = tasks.findIndex(t => t.id === nextTaskId);
            if (nextIndex !== -1) {
              targetInsertIndex = nextIndex;
            }
          } else {
            // Find last task with this target state
            let lastIndexInCol = -1;
            for (let i = 0; i < tasks.length; i++) {
              if (canonicalState(tasks[i].status) === targetState) {
                lastIndexInCol = i;
              }
            }
            if (lastIndexInCol !== -1) {
              targetInsertIndex = lastIndexInCol + 1;
            }
          }
        }
      }

      // Update task status and history if changed
      movedTask.status = targetState;
      movedTask.updated_at = new Date().toISOString();

      if (isChangingColumn) {
        const currentUser = window.VG.Auth && window.VG.Auth.getCurrentUser();
        const currentUname = (currentUser && currentUser.username) ? currentUser.username : null;
        movedTask.history = movedTask.history || [];
        movedTask.history.push({
          from_status: canonicalState(prevStatus),
          to_status: targetState,
          timestamp: new Date().toISOString(),
          reason: 'Moved via drag and drop',
          user: currentUname
        });
      }

      tasks.splice(targetInsertIndex, 0, movedTask);

      if (window.VG.App) {
        window.VG.App.persistChanges(`Task moved to ${STATES.find(s => s.id === targetState)?.label || targetState}`);
      }
      renderBoard();
    });
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function setTagFilter(name) {
    const select = document.getElementById('tagFilter');
    if (!select) return;
    const option = [...select.options].find(o => o.value.toLowerCase() === String(name).toLowerCase());
    select.value = option && select.value !== option.value ? option.value : 'all';
    renderBoard();
  }

  /** Quick tag editor opened from a card */
  async function editTaskTags(task) {
    const UI = window.VG.UI;
    let picker = null;
    const names = await UI.dialog({
      title: `Tags · ${task.name}`,
      size: 'tiny',
      content: '<div class="ui inverted form"><div class="field"><div class="tag-picker-host"></div></div><p class="tag-picker-hint">Type to search; press Enter to create a new tag.</p></div>',
      dismissValue: null,
      buttons: [
        { text: 'Cancel', value: null, cls: 'basic inverted' },
        { text: 'Save tags', value: 'read', cls: 'primary' }
      ],
      onShow: (el) => {
        picker = window.VG.Tags.createPicker(el.querySelector('.tag-picker-host'));
        picker.setValue(task.tags || []);
        picker.focus();
      },
      readValue: () => (picker ? picker.getValue() : null)
    });
    if (names === null || names === undefined) return;

    const next = window.VG.Tags.ensure(names);
    const changed = next.join('\n') !== (task.tags || []).join('\n');
    if (!changed) return;
    task.tags = next;
    task.updated_at = new Date().toISOString();
    window.VG.App.persistChanges('Tags updated');
    renderBoard();
  }

  function toggleTaskSelection(taskId, isSelected) {
    bulkBarDismissed = false;
    if (isSelected) {
      selectedTaskIds.add(taskId);
    } else {
      selectedTaskIds.delete(taskId);
    }
    const card = document.querySelector(`.task-card[data-task-id="${CSS.escape(taskId)}"]`);
    if (card) {
      card.classList.toggle('is-selected', isSelected);
      const cb = card.querySelector('.card-select-checkbox');
      if (cb) cb.checked = isSelected;
    }
    updateBulkActionUI();
  }

  function selectAllVisible() {
    bulkBarDismissed = false;
    visibleTasks.forEach(t => {
      selectedTaskIds.add(t.id);
      const card = document.querySelector(`.task-card[data-task-id="${CSS.escape(t.id)}"]`);
      if (card) {
        card.classList.add('is-selected');
        const cb = card.querySelector('.card-select-checkbox');
        if (cb) cb.checked = true;
      }
    });
    updateBulkActionUI();
  }

  function clearSelection() {
    selectedTaskIds.clear();
    document.querySelectorAll('.task-card.is-selected').forEach(card => {
      card.classList.remove('is-selected');
      const cb = card.querySelector('.card-select-checkbox');
      if (cb) cb.checked = false;
    });
    updateBulkActionUI();
  }

  function dismissBulkBar() {
    bulkBarDismissed = true;
    selectedTaskIds.clear();
    document.querySelectorAll('.task-card.is-selected').forEach(card => {
      card.classList.remove('is-selected');
      const cb = card.querySelector('.card-select-checkbox');
      if (cb) cb.checked = false;
    });
    const bulkActionBar = document.getElementById('bulkActionBar');
    if (bulkActionBar) {
      bulkActionBar.hidden = true;
    }
    updateBulkActionUI();
  }

  function resetBulkBarDismissed() {
    bulkBarDismissed = false;
  }

  function getSelectedTaskIds() {
    return Array.from(selectedTaskIds);
  }

  function getVisibleTasks() {
    return visibleTasks.slice();
  }

  function updateBulkActionUI() {
    const tasks = window.VG.App ? window.VG.App.getTasks() : [];
    const searchInput = document.getElementById('searchInput');
    const priorityFilter = document.getElementById('priorityFilter');
    const typeFilterEl = document.getElementById('typeFilter');
    const tagFilterEl = document.getElementById('tagFilter');
    const userFilterEl = document.getElementById('userFilter');

    const chkAssignee = document.getElementById('chkCriteriaAssignee');
    const chkCreator = document.getElementById('chkCriteriaCreator');
    const chkCommenter = document.getElementById('chkCriteriaCommenter');
    const chkUploader = document.getElementById('chkCriteriaUploader');
    const criteriaCount = (chkAssignee && chkAssignee.checked ? 1 : 0) +
      (chkCreator && chkCreator.checked ? 1 : 0) +
      (chkCommenter && chkCommenter.checked ? 1 : 0) +
      (chkUploader && chkUploader.checked ? 1 : 0);

    const query = searchInput ? searchInput.value.trim() : '';
    const prioFilter = priorityFilter ? priorityFilter.value : 'all';
    const typeFilter = typeFilterEl ? typeFilterEl.value : 'all';
    const tagFilter = tagFilterEl && !tagFilterEl.disabled ? tagFilterEl.value : 'all';
    const userFilter = userFilterEl && !userFilterEl.disabled ? userFilterEl.value : 'all';
    const isFiltered = !!query || prioFilter !== 'all' || typeFilter !== 'all' || tagFilter !== 'all' || userFilter !== 'all' || criteriaCount < 4;

    const bulkActionBar = document.getElementById('bulkActionBar');
    const bulkBarCount = document.getElementById('bulkBarCount');
    const bulkBarLabel = document.getElementById('bulkBarLabel');
    const btnBulkBarTag = document.getElementById('btnBulkBarTag');

    const selectedCount = selectedTaskIds.size;
    const visibleCount = visibleTasks.length;

    // Floating bar
    if (bulkActionBar) {
      if (selectedCount > 0) {
        bulkActionBar.hidden = false;
        if (bulkBarCount) bulkBarCount.textContent = selectedCount;
        if (bulkBarLabel) bulkBarLabel.textContent = selectedCount === 1 ? 'task selected' : 'tasks selected';
        if (btnBulkBarTag) btnBulkBarTag.innerHTML = '<i class="tags icon"></i> Assign Tags...';
      } else if (!bulkBarDismissed && isFiltered && visibleCount > 0) {
        // Also display the bar when filtered so bulk action is immediately accessible
        bulkActionBar.hidden = false;
        if (bulkBarCount) bulkBarCount.textContent = visibleCount;
        if (bulkBarLabel) bulkBarLabel.textContent = visibleCount === 1 ? 'filtered task' : 'filtered tasks';
        if (btnBulkBarTag) btnBulkBarTag.innerHTML = `<i class="tags icon"></i> Assign Tags (${visibleCount})...`;
      } else {
        bulkActionBar.hidden = true;
      }

      const btnBulkBarFavorite = document.getElementById('btnBulkBarFavorite');
      const btnBulkBarFavoriteText = document.getElementById('btnBulkBarFavoriteText');
      if (btnBulkBarFavorite) {
        let targetTasks = [];
        if (selectedCount > 0) {
          targetTasks = tasks.filter(t => selectedTaskIds.has(t.id));
        } else if (visibleCount > 0) {
          targetTasks = visibleTasks;
        }
        const anyNotFav = targetTasks.some(t => !t.favorite);
        if (btnBulkBarFavoriteText) {
          btnBulkBarFavoriteText.textContent = anyNotFav ? 'Highlight' : 'Remove Highlight';
        }
        const favIcon = btnBulkBarFavorite.querySelector('i.icon');
        if (favIcon) {
          favIcon.className = anyNotFav ? 'star icon' : 'star outline icon';
        }
        btnBulkBarFavorite.title = anyNotFav
          ? `Highlight ${targetTasks.length} task${targetTasks.length === 1 ? '' : 's'}`
          : `Remove highlight from ${targetTasks.length} task${targetTasks.length === 1 ? '' : 's'}`;
      }
    }
  }

  async function openBulkTagDialog(customTaskIds) {
    const allTasks = window.VG.App ? window.VG.App.getTasks() : [];
    if (!allTasks.length) {
      window.VG.UI.toast('Board is empty. No tasks to tag.', 'info');
      return;
    }

    let targetTasks = [];
    if (customTaskIds && customTaskIds.length) {
      const idSet = new Set(customTaskIds);
      targetTasks = allTasks.filter(t => idSet.has(t.id));
    } else if (selectedTaskIds.size > 0) {
      targetTasks = allTasks.filter(t => selectedTaskIds.has(t.id));
    } else if (visibleTasks.length > 0) {
      targetTasks = visibleTasks.slice();
    } else {
      targetTasks = allTasks.slice();
    }

    if (!targetTasks.length) {
      window.VG.UI.toast('No matching tasks found to tag.', 'warning');
      return;
    }

    const UI = window.VG.UI;
    const Tags = window.VG.Tags;
    let picker = null;

    const modalContent = `
      <div class="bulk-tag-dialog-content">
        <div class="bulk-tag-banner">
          <i class="tags icon"></i>
          <div class="banner-text">
            <div class="banner-title">Assigning tags to <strong id="bulkModalBannerCount">${targetTasks.length}</strong> task(s)</div>
            <div class="banner-subtitle">Pick or type tags to add. Existing tags will be preserved.</div>
          </div>
        </div>

        <div class="ui inverted form bulk-tag-form">
          <div class="field">
            <label>Tags to add</label>
            <div class="bulk-tag-picker-host"></div>
            <small class="tag-picker-hint">Type to search existing tags or press Enter to create a new tag.</small>
          </div>
        </div>

        <div class="bulk-tag-targets-section">
          <div class="bulk-tag-targets-header">
            <span><i class="tasks icon"></i> Target tasks (<span id="bulkModalListCount">${targetTasks.length}</span>):</span>
            <button type="button" class="ui mini basic inverted button btn-bulk-modal-toggle-all">Select none</button>
          </div>
          <div class="bulk-tag-targets-list">
            ${targetTasks.map(t => {
              const prioKey = canonicalPriority(t.priority);
              const prioMeta = PRIORITIES[prioKey] || PRIORITIES['medium'];
              return `
                <label class="bulk-target-item">
                  <input type="checkbox" class="bulk-modal-task-check" data-task-id="${escapeHtml(t.id)}" checked />
                  <span class="bulk-target-info">
                    <span class="bulk-target-title" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                    <span class="bulk-target-meta">
                      <span class="ui mini ${prioMeta.color} label">${escapeHtml(prioMeta.label)}</span>
                      ${(t.tags && t.tags.length) ? t.tags.map(tag => `<span class="ui mini label ${Tags.colorOf(tag)}">${escapeHtml(tag)}</span>`).join('') : '<span class="no-tags">No tags</span>'}
                    </span>
                  </span>
                </label>
              `;
            }).join('')}
          </div>
        </div>

        <div class="ui mini info inverted message bulk-tag-note">
          <i class="info circle icon"></i>
          Tags will be added to the selected tasks without removing their current tags. New tags will be added to the board registry.
        </div>
      </div>
    `;

    const res = await UI.dialog({
      title: 'Bulk Assign Tags',
      size: 'small',
      content: modalContent,
      dismissValue: null,
      buttons: [
        { text: 'Cancel', value: null, cls: 'basic inverted' },
        { text: `Add Tags (${targetTasks.length})`, value: 'read', cls: 'teal' }
      ],
      onShow: (el) => {
        const pickerHost = el.querySelector('.bulk-tag-picker-host');
        picker = Tags.createPicker(pickerHost, { placeholder: 'Select or create tags...' });
        picker.focus();

        const bannerCount = el.querySelector('#bulkModalBannerCount');
        const listCount = el.querySelector('#bulkModalListCount');
        const toggleAllBtn = el.querySelector('.btn-bulk-modal-toggle-all');
        const checkboxes = el.querySelectorAll('.bulk-modal-task-check');
        const submitBtn = el.querySelector('.actions .button[data-index="1"]');

        const updateCount = () => {
          const checked = el.querySelectorAll('.bulk-modal-task-check:checked');
          const count = checked.length;
          if (bannerCount) bannerCount.textContent = count;
          if (listCount) listCount.textContent = count;
          if (submitBtn) {
            submitBtn.textContent = `Add Tags (${count})`;
            submitBtn.classList.toggle('disabled', count === 0);
          }
          if (toggleAllBtn) {
            toggleAllBtn.textContent = count === checkboxes.length ? 'Select none' : 'Select all';
          }
        };

        checkboxes.forEach(cb => {
          cb.addEventListener('change', updateCount);
        });

        if (toggleAllBtn) {
          toggleAllBtn.addEventListener('click', () => {
            const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
            checkboxes.forEach(cb => { cb.checked = anyUnchecked; });
            updateCount();
          });
        }

        if (submitBtn) {
          submitBtn.addEventListener('click', (e) => {
            const rawTags = picker ? picker.getValue() : [];
            const checkedBoxes = el.querySelectorAll('.bulk-modal-task-check:checked');
            if (!rawTags.length) {
              e.stopImmediatePropagation();
              UI.toast('Please select or create at least one tag to add', 'warning');
              picker.focus();
              return;
            }
            if (!checkedBoxes.length) {
              e.stopImmediatePropagation();
              UI.toast('Please select at least one task to receive tags', 'warning');
              return;
            }
          }, true);
        }
      },
      readValue: (el) => {
        const rawTags = picker ? picker.getValue() : [];
        const checkedIds = Array.from(el.querySelectorAll('.bulk-modal-task-check:checked'))
          .map(cb => cb.getAttribute('data-task-id'));
        return { tagNames: rawTags, selectedIds: checkedIds };
      }
    });

    if (!res || !res.tagNames || !res.tagNames.length || !res.selectedIds || !res.selectedIds.length) {
      return;
    }

    const tagsToAdd = Tags.ensure(res.tagNames);
    const targetSet = new Set(res.selectedIds);
    let modifiedCount = 0;

    allTasks.forEach(task => {
      if (!targetSet.has(task.id)) return;
      const current = task.tags || [];
      const combined = [...current, ...tagsToAdd];
      const next = Tags.ensure(combined);
      const changed = next.length !== current.length || next.some((t, i) => t !== current[i]);
      if (changed) {
        task.tags = next;
        task.updated_at = new Date().toISOString();
        modifiedCount++;
      }
    });

    if (modifiedCount > 0) {
      clearSelection();
      window.VG.App.persistChanges(`Assigned tags to ${modifiedCount} task${modifiedCount === 1 ? '' : 's'}`);
      renderBoard();
    } else {
      clearSelection();
      UI.toast('Selected tasks already have these tags', 'info');
      renderBoard();
    }
  }

  function toggleTaskFavorite(taskId) {
    const tasks = window.VG.App ? window.VG.App.getTasks() : [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    task.favorite = !task.favorite;
    task.updated_at = new Date().toISOString();
    const actionMsg = task.favorite ? `"${task.name}" marked as favorite` : `Favorite removed from "${task.name}"`;
    window.VG.App.persistChanges(actionMsg);
    renderBoard();
  }

  function toggleFavoriteFilter() {
    filterFavoriteOnly = !filterFavoriteOnly;
    renderBoard();
    return filterFavoriteOnly;
  }

  function setFavoriteFilter(active) {
    filterFavoriteOnly = Boolean(active);
    renderBoard();
  }

  function isFavoriteFilterActive() {
    return filterFavoriteOnly;
  }

  function toggleBulkSelectionFavorite() {
    const tasks = window.VG.App ? window.VG.App.getTasks() : [];
    if (!tasks.length) return;

    let targetTasks = [];
    if (selectedTaskIds.size > 0) {
      targetTasks = tasks.filter(t => selectedTaskIds.has(t.id));
    } else if (visibleTasks.length > 0) {
      targetTasks = visibleTasks.slice();
    } else {
      targetTasks = tasks.slice();
    }

    if (!targetTasks.length) return;

    const anyNotFavorite = targetTasks.some(t => !t.favorite);
    const newStatus = anyNotFavorite;
    const now = new Date().toISOString();

    targetTasks.forEach(t => {
      t.favorite = newStatus;
      t.updated_at = now;
    });

    const actionMsg = newStatus
      ? `Marked ${targetTasks.length} task${targetTasks.length === 1 ? '' : 's'} as favorite`
      : `Removed favorite from ${targetTasks.length} task${targetTasks.length === 1 ? '' : 's'}`;
    window.VG.App.persistChanges(actionMsg);
    renderBoard();
  }

  window.VG.Board = {
    setTagFilter,
    editTaskTags,
    renderBoardColumns,
    renderBoard,
    renderTaskCard,
    toggleTaskSelection,
    selectAllVisible,
    clearSelection,
    dismissBulkBar,
    resetBulkBarDismissed,
    getSelectedTaskIds,
    getVisibleTasks,
    updateBulkActionUI,
    openBulkTagDialog,
    toggleTaskFavorite,
    toggleFavoriteFilter,
    setFavoriteFilter,
    isFavoriteFilterActive,
    toggleBulkSelectionFavorite
  };
})();
