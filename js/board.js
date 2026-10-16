/**
 * vg-task-manager: Board Rendering & Drag-and-Drop Interaction
 */
(function() {
  window.VG = window.VG || {};
  const { STATES, PRIORITIES, canonicalState, canonicalPriority, escapeHtml, escapeCss, formatRelativeTime } = window.VG.Constants;
  const Storage = window.VG.Storage;

  let collapsedColumns = Storage.loadCollapsedColumns();
  let draggedTaskId = null;
  let isDragging = false;

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
    STATES.forEach(st => {
      const isCollapsed = collapsedColumns.has(st.id);
      const colEl = document.createElement('div');
      colEl.className = `ui ${st.color} segment board-column ${isCollapsed ? 'collapsed' : ''}`;
      colEl.setAttribute('data-col-state', st.id);
      if (isCollapsed) {
        colEl.setAttribute('title', `${st.label} (Collapsed - Click to expand)`);
      }

      colEl.innerHTML = `
        <div class="column-header">
          <h4 class="ui header column-title">
            <i class="${st.icon} ${st.color} icon"></i>
            <div class="content">${escapeHtml(st.label)}</div>
          </h4>
          <span class="ui circular ${st.color} basic mini label col-badge" id="badge-${escapeCss(st.id)}">0</span>
          <div class="column-header-actions">
            <button class="ui mini basic icon button col-btn-add" title="Add task to ${escapeHtml(st.label)}" aria-label="Add task to ${escapeHtml(st.label)}">
              <i class="plus icon"></i>
            </button>
            <button class="ui mini basic icon button col-btn-toggle" title="${isCollapsed ? 'Expand column' : 'Collapse column'}" aria-label="${isCollapsed ? 'Expand column' : 'Collapse column'}">
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
    const taskStatsCounter = document.getElementById('taskStatsCounter');

    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const prioFilter = priorityFilter ? priorityFilter.value : 'all';

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

    tasks.forEach(t => {
      const st = canonicalState(t.status);
      if (counts[st] !== undefined) {
        counts[st]++;
      }
      counts.total++;

      // Check query match (title, desc, openspec, or attachment filenames)
      const matchesAttachment = t.attachments && t.attachments.some(a => 
        a.filename.toLowerCase().includes(query) || (a.name && a.name.toLowerCase().includes(query))
      );

      const matchesQuery = !query || 
        t.name.toLowerCase().includes(query) || 
        t.description.toLowerCase().includes(query) ||
        (t['openspec-id'] && t['openspec-id'].toLowerCase().includes(query)) ||
        matchesAttachment;

      const matchesPriority = prioFilter === 'all' || t.priority === prioFilter;

      if (matchesQuery && matchesPriority) {
        renderTaskCard(t, query);
        counts.shown++;
      }
    });

    // Update column badges & empty placeholders
    STATES.forEach(st => {
      const badge = document.getElementById(`badge-${escapeCss(st.id)}`);
      if (badge) badge.textContent = counts[st.id] || 0;

      const container = document.getElementById(`col-container-${escapeCss(st.id)}`);
      if (container && container.children.length === 0) {
        container.innerHTML = EMPTY_COLUMN_HTML;
      }
    });

    // Update header statistics
    if (taskStatsCounter) {
      const isFiltered = query || prioFilter !== 'all';
      const shownStr = isFiltered ? ` (${counts.shown} shown)` : '';
      taskStatsCounter.textContent = `${counts.total} tasks${shownStr} · ${counts['in progress']} in progress · ${counts.blocked} blocked`;
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
    const openSpecId = task['openspec-id'];

    const card = document.createElement('div');
    card.className = `ui fluid card task-card prio-${prioKey}`;
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${task.name} (${prioMeta.label} priority)`);
    card.setAttribute('data-task-id', task.id);

    const commentsCount = task.comments ? task.comments.length : 0;
    const historyCount = task.history ? task.history.length : 0;
    const attachmentsCount = task.attachments ? task.attachments.length : 0;
    const lastUpdateStr = formatRelativeTime(task.updated_at || task.created_at);
    const descText = window.VG.Markdown.toPlainText(task.description);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    card.innerHTML = `
      <div class="content">
        <div class="card-top">
          <span class="ui mini ${prioMeta.color} label">
            <i class="${prioMeta.icon} icon"></i>${escapeHtml(prioMeta.label)}
          </span>
          ${openSpecId ? `
            <span class="ui mini basic teal label card-openspec" title="OpenSpec: ${escapeHtml(openSpecId)}">
              <i class="file alternate outline icon"></i>${escapeHtml(openSpecId)}
            </span>` : ''}
          <span class="card-id">#${escapeHtml(task.id.slice(-6))}</span>
        </div>
        <div class="header card-title">${highlight(task.name, query)}</div>
        ${descText ? `<div class="description card-desc">${highlight(descText, query)}</div>` : ''}
      </div>
      <div class="extra content card-footer">
        <span class="card-meta">
          ${attachmentsCount > 0 ? `<span title="${plural(attachmentsCount, 'attachment')}"><i class="paperclip icon"></i>${attachmentsCount}</span>` : ''}
          ${commentsCount > 0 ? `<span title="${plural(commentsCount, 'comment')}"><i class="comment outline icon"></i>${commentsCount}</span>` : ''}
          <span title="${plural(historyCount, 'transition')}"><i class="history icon"></i>${historyCount}</span>
        </span>
        <span class="card-footer-right">
          <span class="card-updated">${lastUpdateStr}</span>
          <button type="button" class="ui mini basic icon button card-open-page" title="Open task page" aria-label="Open task page">
            <i class="external alternate icon"></i>
          </button>
        </span>
      </div>
    `;

    // Click to edit (the corner button opens the full task page)
    card.addEventListener('click', (e) => {
      if (isDragging) return;
      if (e.target.closest('.card-open-page')) {
        e.stopPropagation();
        if (window.VG.TaskPage) window.VG.TaskPage.open(task.id);
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

      const afterElement = getDragAfterElement(container, e.clientY);
      if (afterElement == null) {
        container.appendChild(dropPlaceholder);
      } else {
        container.insertBefore(dropPlaceholder, afterElement);
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

      // Determine insert index
      let targetInsertIndex = tasks.length;
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

      // Update task status and history if changed
      movedTask.status = targetState;
      movedTask.updated_at = new Date().toISOString();

      if (canonicalState(prevStatus) !== targetState) {
        movedTask.history = movedTask.history || [];
        movedTask.history.push({
          from_status: canonicalState(prevStatus),
          to_status: targetState,
          timestamp: new Date().toISOString(),
          reason: 'Moved via drag and drop'
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

  window.VG.Board = {
    renderBoardColumns,
    renderBoard,
    renderTaskCard
  };
})();
