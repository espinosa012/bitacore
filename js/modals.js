/**
 * vg-task-manager: Modals Management (Create, Edit, Comments, History, Attachments)
 */
(function() {
  window.VG = window.VG || {};
  const { STATES, canonicalState, canonicalPriority, escapeHtml, formatRelativeTime, formatFileSize, getFileIcon } = window.VG.Constants;
  const Attachments = window.VG.Attachments;

  let activeEditingTaskId = null;
  let activeTab = 'tabAttachments';

  function initModals() {
    const modalCreateOverlay = document.getElementById('modalCreateOverlay');
    const modalEditOverlay = document.getElementById('modalEditOverlay');
    const closeCreateModalBtn = document.getElementById('closeCreateModalBtn');
    const cancelCreateBtn = document.getElementById('cancelCreateBtn');
    const closeEditModalBtn = document.getElementById('closeEditModalBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const createTaskForm = document.getElementById('createTaskForm');
    const btnSaveTask = document.getElementById('btnSaveTask');
    const btnDeleteTask = document.getElementById('btnDeleteTask');

    // Tab buttons
    const tabBtnAttachments = document.getElementById('tabBtnAttachments');
    const tabBtnComments = document.getElementById('tabBtnComments');
    const tabBtnHistory = document.getElementById('tabBtnHistory');

    if (closeCreateModalBtn) closeCreateModalBtn.addEventListener('click', closeCreateModal);
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', closeCreateModal);
    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);

    if (modalCreateOverlay) {
      modalCreateOverlay.addEventListener('click', (e) => {
        if (e.target === modalCreateOverlay) closeCreateModal();
      });
    }

    if (modalEditOverlay) {
      modalEditOverlay.addEventListener('click', (e) => {
        if (e.target === modalEditOverlay) closeEditModal();
      });
    }

    if (tabBtnAttachments) tabBtnAttachments.addEventListener('click', () => switchTab('tabAttachments'));
    if (tabBtnComments) tabBtnComments.addEventListener('click', () => switchTab('tabComments'));
    if (tabBtnHistory) tabBtnHistory.addEventListener('click', () => switchTab('tabHistory'));

    if (createTaskForm) {
      createTaskForm.addEventListener('submit', handleCreateTaskSubmit);
    }

    if (btnSaveTask) {
      btnSaveTask.addEventListener('click', handleSaveTaskDetails);
    }

    if (btnDeleteTask) {
      btnDeleteTask.addEventListener('click', handleDeleteTask);
    }

    // Comment form
    const addCommentForm = document.getElementById('addCommentForm');
    if (addCommentForm) {
      addCommentForm.addEventListener('submit', handleAddCommentSubmit);
    }

    // Attachment upload handlers in Edit Modal
    setupAttachmentUploadHandlers();
  }

  function openCreateModal(defaultState = 'planned') {
    const modalCreateOverlay = document.getElementById('modalCreateOverlay');
    const createTaskForm = document.getElementById('createTaskForm');
    const taskStateSelect = document.getElementById('newTaskState');

    if (createTaskForm) createTaskForm.reset();
    if (taskStateSelect) taskStateSelect.value = defaultState;

    if (modalCreateOverlay) {
      modalCreateOverlay.classList.add('active');
      const nameInput = document.getElementById('newTaskName');
      if (nameInput) setTimeout(() => nameInput.focus(), 50);
    }
  }

  function closeCreateModal() {
    const modalCreateOverlay = document.getElementById('modalCreateOverlay');
    if (modalCreateOverlay) modalCreateOverlay.classList.remove('active');
  }

  async function handleCreateTaskSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('newTaskName');
    const descInput = document.getElementById('newTaskDesc');
    const openspecInput = document.getElementById('newTaskOpenspecId');
    const prioInput = document.getElementById('newTaskPriority');
    const stateInput = document.getElementById('newTaskState');

    const name = nameInput.value.trim();
    if (!name) return;

    const id = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();
    const targetState = canonicalState(stateInput.value);

    const newTask = {
      id,
      name,
      description: descInput.value.trim(),
      'openspec-id': openspecInput.value.trim(),
      priority: canonicalPriority(prioInput.value),
      status: targetState,
      created_at: now,
      updated_at: now,
      history: [
        {
          from_status: null,
          to_status: targetState,
          timestamp: now,
          reason: 'Initial task creation'
        }
      ],
      comments: [],
      attachments: []
    };

    const tasks = window.VG.App.getTasks();
    tasks.unshift(newTask);

    closeCreateModal();
    window.VG.App.persistChanges('Task created successfully');
    window.VG.Board.renderBoard();
  }

  function openEditModal(task) {
    activeEditingTaskId = task.id;
    const modalEditOverlay = document.getElementById('modalEditOverlay');
    if (!modalEditOverlay) return;

    // Set values in modal
    document.getElementById('editTaskIdLabel').textContent = `#${task.id}`;
    document.getElementById('editTaskName').value = task.name || '';
    document.getElementById('editTaskDesc').value = task.description || '';
    document.getElementById('editTaskOpenspecId').value = task['openspec-id'] || '';
    document.getElementById('editTaskPriority').value = canonicalPriority(task.priority);
    document.getElementById('editTaskState').value = canonicalState(task.status);

    renderAttachmentsTab(task);
    renderCommentsTab(task);
    renderHistoryTab(task);

    switchTab('tabAttachments');
    modalEditOverlay.classList.add('active');
  }

  function closeEditModal() {
    const modalEditOverlay = document.getElementById('modalEditOverlay');
    if (modalEditOverlay) modalEditOverlay.classList.remove('active');
    activeEditingTaskId = null;
  }

  function switchTab(tabId) {
    activeTab = tabId;

    const tabBtnAttachments = document.getElementById('tabBtnAttachments');
    const tabBtnComments = document.getElementById('tabBtnComments');
    const tabBtnHistory = document.getElementById('tabBtnHistory');

    const tabAttachments = document.getElementById('tabAttachments');
    const tabComments = document.getElementById('tabComments');
    const tabHistory = document.getElementById('tabHistory');

    if (tabBtnAttachments) tabBtnAttachments.classList.toggle('active', tabId === 'tabAttachments');
    if (tabBtnComments) tabBtnComments.classList.toggle('active', tabId === 'tabComments');
    if (tabBtnHistory) tabBtnHistory.classList.toggle('active', tabId === 'tabHistory');

    if (tabAttachments) tabAttachments.classList.toggle('active', tabId === 'tabAttachments');
    if (tabComments) tabComments.classList.toggle('active', tabId === 'tabComments');
    if (tabHistory) tabHistory.classList.toggle('active', tabId === 'tabHistory');
  }

  function handleSaveTaskDetails() {
    if (!activeEditingTaskId) return;
    const tasks = window.VG.App.getTasks();
    const task = tasks.find(t => t.id === activeEditingTaskId);
    if (!task) return;

    const name = document.getElementById('editTaskName').value.trim();
    if (!name) {
      alert('Task name cannot be empty.');
      return;
    }

    const prevStatus = task.status;
    const newStatus = canonicalState(document.getElementById('editTaskState').value);

    task.name = name;
    task.description = document.getElementById('editTaskDesc').value.trim();
    task['openspec-id'] = document.getElementById('editTaskOpenspecId').value.trim();
    task.priority = canonicalPriority(document.getElementById('editTaskPriority').value);
    task.status = newStatus;
    task.updated_at = new Date().toISOString();

    if (canonicalState(prevStatus) !== newStatus) {
      task.history = task.history || [];
      task.history.push({
        from_status: canonicalState(prevStatus),
        to_status: newStatus,
        timestamp: new Date().toISOString(),
        reason: 'Status changed in task details'
      });
    }

    closeEditModal();
    window.VG.App.persistChanges('Task updated successfully');
    window.VG.Board.renderBoard();
  }

  async function handleDeleteTask() {
    if (!activeEditingTaskId) return;
    const tasks = window.VG.App.getTasks();
    const task = tasks.find(t => t.id === activeEditingTaskId);
    if (!task) return;

    if (confirm(`Are you sure you want to delete task "${task.name}"? All attachments will also be removed.`)) {
      // Remove attachments from IndexedDB and local directory
      await window.VG.Storage.deleteTaskAttachments(task.id);
      if (window.VG.FsSync && window.VG.FsSync.isLinked()) {
        // Folder clean up if supported
      }

      const idx = tasks.findIndex(t => t.id === activeEditingTaskId);
      if (idx !== -1) tasks.splice(idx, 1);

      closeEditModal();
      window.VG.App.persistChanges('Task deleted');
      window.VG.Board.renderBoard();
    }
  }

  /* -------------------------------------------------------------
   * ATTACHMENTS TAB RENDERING & HANDLING
   * ------------------------------------------------------------- */

  function renderAttachmentsTab(task) {
    const listEl = document.getElementById('attachmentsList');
    const tabBtn = document.getElementById('tabBtnAttachments');
    const count = task.attachments ? task.attachments.length : 0;

    if (tabBtn) tabBtn.textContent = `Attachments (${count})`;
    if (!listEl) return;

    if (!task.attachments || task.attachments.length === 0) {
      listEl.innerHTML = `<div class="attachment-empty">No files attached yet. Upload images, docs, audio, or PDFs below.</div>`;
      return;
    }

    listEl.innerHTML = '';
    task.attachments.forEach(att => {
      const card = document.createElement('div');
      card.className = 'attachment-card';
      const icon = getFileIcon(att.filename);
      const sizeStr = formatFileSize(att.size);
      const dateStr = formatRelativeTime(att.created_at);

      card.innerHTML = `
        <div class="attachment-left">
          <div class="attachment-icon-wrap" title="${escapeHtml(att.type || 'file')}">${icon}</div>
          <div class="attachment-details">
            <div class="attachment-filename" title="${escapeHtml(att.filename)}">${escapeHtml(att.filename)}</div>
            ${att.name ? `<div class="attachment-custom-name">${escapeHtml(att.name)}</div>` : ''}
            ${att.description ? `<div class="attachment-desc">${escapeHtml(att.description)}</div>` : ''}
            <div class="attachment-meta">
              <span>${sizeStr}</span>
              <span>·</span>
              <span>${dateStr}</span>
            </div>
          </div>
        </div>
        <div class="attachment-actions">
          <button type="button" class="attachment-btn attachment-btn-download" title="Open or download file" data-open-att="${att.id}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Open</span>
          </button>
          <button type="button" class="attachment-btn" title="Edit name & description" data-edit-att="${att.id}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button type="button" class="attachment-btn attachment-btn-delete" title="Delete attachment" data-delete-att="${att.id}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      `;

      // Open / Download
      const openBtn = card.querySelector('[data-open-att]');
      if (openBtn) {
        openBtn.addEventListener('click', () => {
          Attachments.openOrDownloadAttachment(task, att);
        });
      }

      // Edit details
      const editBtn = card.querySelector('[data-edit-att]');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          const newName = prompt('Attachment display name (optional):', att.name || '');
          if (newName !== null) {
            const newDesc = prompt('Attachment description (optional):', att.description || '');
            if (newDesc !== null) {
              Attachments.updateAttachmentDetails(task, att.id, newName, newDesc);
              renderAttachmentsTab(task);
              window.VG.App.persistChanges('Attachment details updated');
            }
          }
        });
      }

      // Delete
      const deleteBtn = card.querySelector('[data-delete-att]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (confirm(`Delete attachment "${att.filename}"?`)) {
            await Attachments.deleteAttachmentFromTask(task, att.id);
            renderAttachmentsTab(task);
            window.VG.Board.renderBoard();
            window.VG.App.persistChanges('Attachment deleted');
          }
        });
      }

      listEl.appendChild(card);
    });
  }

  function setupAttachmentUploadHandlers() {
    const uploadBtn = document.getElementById('btnSubmitAttachment');
    const fileInput = document.getElementById('newAttachmentFile');
    const nameInput = document.getElementById('newAttachmentName');
    const descInput = document.getElementById('newAttachmentDesc');
    const dropZone = document.getElementById('attachmentDropZone');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-active');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-active'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-active');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          fileInput.files = e.dataTransfer.files;
          updateFileInputLabel(fileInput.files[0]);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          updateFileInputLabel(fileInput.files[0]);
        }
      });
    }

    if (uploadBtn) {
      uploadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!activeEditingTaskId) return;

        const tasks = window.VG.App.getTasks();
        const task = tasks.find(t => t.id === activeEditingTaskId);
        if (!task) return;

        if (!fileInput.files || fileInput.files.length === 0) {
          alert('Please select a file to attach first.');
          return;
        }

        const file = fileInput.files[0];
        const customName = nameInput ? nameInput.value.trim() : '';
        const customDesc = descInput ? descInput.value.trim() : '';

        try {
          await Attachments.addAttachmentToTask(task, file, customName, customDesc);

          // Reset inputs
          fileInput.value = '';
          if (nameInput) nameInput.value = '';
          if (descInput) descInput.value = '';
          resetFileInputLabel();

          renderAttachmentsTab(task);
          window.VG.Board.renderBoard();
          window.VG.App.persistChanges(`Attached ${file.name}`);
        } catch (err) {
          alert('Error adding attachment: ' + err.message);
        }
      });
    }
  }

  function updateFileInputLabel(file) {
    const label = document.querySelector('.attachment-drop-text');
    if (label && file) {
      label.innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${formatFileSize(file.size)})`;
    }
  }

  function resetFileInputLabel() {
    const label = document.querySelector('.attachment-drop-text');
    if (label) {
      label.innerHTML = 'Drag & drop a file here or <span>browse from computer</span>';
    }
  }

  /* -------------------------------------------------------------
   * COMMENTS & HISTORY TAB RENDERING
   * ------------------------------------------------------------- */

  function renderCommentsTab(task) {
    const listEl = document.getElementById('commentsList');
    const tabBtn = document.getElementById('tabBtnComments');
    const count = task.comments ? task.comments.length : 0;

    if (tabBtn) tabBtn.textContent = `Comments (${count})`;
    if (!listEl) return;

    if (!task.comments || task.comments.length === 0) {
      listEl.innerHTML = `<div class="attachment-empty">No comments yet. Add one below.</div>`;
      return;
    }

    listEl.innerHTML = '';
    task.comments.forEach(c => {
      const card = document.createElement('div');
      card.className = 'comment-card';
      card.innerHTML = `
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(c.author || 'User')}</span>
          <span class="comment-date">${formatRelativeTime(c.timestamp)}</span>
        </div>
        <div class="comment-body">${escapeHtml(c.text)}</div>
      `;
      listEl.appendChild(card);
    });
  }

  function handleAddCommentSubmit(e) {
    e.preventDefault();
    if (!activeEditingTaskId) return;

    const tasks = window.VG.App.getTasks();
    const task = tasks.find(t => t.id === activeEditingTaskId);
    if (!task) return;

    const authorInput = document.getElementById('newCommentAuthor');
    const textInput = document.getElementById('newCommentText');

    const text = textInput.value.trim();
    if (!text) return;

    task.comments = task.comments || [];
    task.comments.push({
      id: `comm-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      author: authorInput.value.trim() || 'User',
      text,
      timestamp: new Date().toISOString()
    });
    task.updated_at = new Date().toISOString();

    textInput.value = '';
    renderCommentsTab(task);
    window.VG.Board.renderBoard();
    window.VG.App.persistChanges('Comment added');
  }

  function renderHistoryTab(task) {
    const timelineEl = document.getElementById('historyTimeline');
    const tabBtn = document.getElementById('tabBtnHistory');
    const count = task.history ? task.history.length : 0;

    if (tabBtn) tabBtn.textContent = `History (${count})`;
    if (!timelineEl) return;

    if (!task.history || task.history.length === 0) {
      timelineEl.innerHTML = `<div class="attachment-empty">No history recorded.</div>`;
      return;
    }

    timelineEl.innerHTML = '';
    task.history.forEach(h => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const fromLbl = h.from_status ? (STATES.find(s => s.id === h.from_status)?.label || h.from_status) : 'Created';
      const toLbl = STATES.find(s => s.id === h.to_status)?.label || h.to_status;

      item.innerHTML = `
        <div class="history-trans">
          <span class="history-badge">${fromLbl}</span>
          <span class="history-arrow">→</span>
          <span class="history-badge">${toLbl}</span>
        </div>
        <div class="history-meta">${new Date(h.timestamp).toLocaleString()}</div>
        ${h.reason ? `<div class="history-reason">${escapeHtml(h.reason)}</div>` : ''}
      `;
      timelineEl.appendChild(item);
    });
  }

  window.VG.Modals = {
    initModals,
    openCreateModal,
    closeCreateModal,
    openEditModal,
    closeEditModal,
    switchTab
  };
})();
