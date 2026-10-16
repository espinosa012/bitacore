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
      colEl.className = `column ${isCollapsed ? 'collapsed' : ''}`;
      colEl.setAttribute('data-col-state', st.id);
      if (isCollapsed) {
        colEl.setAttribute('title', `${st.label} (Collapsed - Click to expand)`);
      }

      colEl.innerHTML = `
        <div class="column-header">
          <div class="column-title-group">
            <span class="col-icon" title="${st.label}">${st.icon}</span>
            <span class="col-title">${st.label}</span>
            <span class="col-badge" id="badge-${escapeCss(st.id)}">0</span>
          </div>
          <div class="column-header-actions">
            <button class="col-btn-action col-btn-add" title="Add task to ${st.label}" data-add-state="${st.id}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg>
            </button>
            <button class="col-btn-action col-btn-toggle" title="${isCollapsed ? 'Expand column' : 'Collapse column'}" data-toggle-state="${st.id}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                ${isCollapsed 
                  ? '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>' 
                  : '<path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>'}
              </svg>
            </button>
          </div>
        </div>
        <div class="column-cards-container" id="col-container-${escapeCss(st.id)}"></div>
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
        renderTaskCard(t);
      }
    });

    // Update column badges & empty placeholders
    STATES.forEach(st => {
      const badge = document.getElementById(`badge-${escapeCss(st.id)}`);
      if (badge) badge.textContent = counts[st.id] || 0;

      const container = document.getElementById(`col-container-${escapeCss(st.id)}`);
      if (container && container.children.length === 0) {
        container.innerHTML = `<div class="column-empty">No tasks</div>`;
      }
    });

    // Update header statistics
    if (taskStatsCounter) {
      taskStatsCounter.textContent = `${counts.total} tasks · ${counts['in progress']} in progress · ${counts.blocked} blocked`;
    }
  }

  function renderTaskCard(task) {
    const stId = canonicalState(task.status);
    const colId = escapeCss(stId);
    const container = document.getElementById(`col-container-${colId}`);
    if (!container) return;

    const prioKey = canonicalPriority(task.priority);
    const prioMeta = PRIORITIES[prioKey] || PRIORITIES['medium'];
    const openSpecId = task['openspec-id'];

    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.setAttribute('data-task-id', task.id);

    const commentsCount = task.comments ? task.comments.length : 0;
    const historyCount = task.history ? task.history.length : 0;
    const attachmentsCount = task.attachments ? task.attachments.length : 0;
    const lastUpdateStr = formatRelativeTime(task.updated_at || task.created_at);

    card.innerHTML = `
      <div class="card-top">
        <span class="badge-prio ${prioMeta.css}">${prioMeta.label}</span>
        <div class="card-top-right">
          ${openSpecId ? `
            <span class="badge-openspec" title="OpenSpec: ${escapeHtml(openSpecId)}">
              <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
              <span>${escapeHtml(openSpecId)}</span>
            </span>` : ''}
          <span class="card-id">#${task.id.slice(-6)}</span>
        </div>
      </div>
      <div class="card-title">${escapeHtml(task.name)}</div>
      ${task.description ? `<div class="card-desc">${escapeHtml(task.description)}</div>` : ''}
      <div class="card-footer">
        <div class="card-meta-indicators">
          ${attachmentsCount > 0 ? `
            <span class="meta-indicator meta-indicator-attachments" title="${attachmentsCount} attachment${attachmentsCount === 1 ? '' : 's'}">
              <svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              <span>${attachmentsCount}</span>
            </span>` : ''}
          ${commentsCount > 0 ? `
            <span class="meta-indicator" title="${commentsCount} comment${commentsCount === 1 ? '' : 's'}">
              <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
              <span>${commentsCount}</span>
            </span>` : ''}
          <span class="meta-indicator" title="${historyCount} transition${historyCount === 1 ? '' : 's'}">
            <svg viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
            <span>${historyCount}</span>
          </span>
        </div>
        <span class="card-updated">${lastUpdateStr}</span>
      </div>
    `;

    // Click to edit
    card.addEventListener('click', (e) => {
      if (isDragging) return;
      if (window.VG.Modals) window.VG.Modals.openEditModal(task);
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
            container.innerHTML = '<div class="column-empty">No tasks</div>';
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
