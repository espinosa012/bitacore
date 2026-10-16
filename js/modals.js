/**
 * vg-task-manager: Modals Management (Create, Edit, Comments, History, Attachments)
 */
(function() {
  window.VG = window.VG || {};
  const { STATES, canonicalState, canonicalPriority, escapeHtml, formatRelativeTime, formatFileSize, getFileIcon } = window.VG.Constants;
  const Attachments = window.VG.Attachments;
  const UI = window.VG.UI;

  let activeEditingTaskId = null;
  let activeTab = 'tabAttachments';
  let createDescEditor = null;
  let editDescEditor = null;
  let createTagPicker = null;
  let editTagPicker = null;
  let lastFocusedCard = null;
  let restoreFocusOnHide = true;

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

    // MongoDB connection modal elements
    const modalMongoOverlay = document.getElementById('modalMongoOverlay');
    const closeMongoModalBtn = document.getElementById('closeMongoModalBtn');
    const cancelMongoBtn = document.getElementById('cancelMongoBtn');
    const mongoConnectForm = document.getElementById('mongoConnectForm');
    const btnDisconnectMongo = document.getElementById('btnDisconnectMongo');
    const closeMongoErrorBtn = document.getElementById('closeMongoErrorBtn');

    if (closeMongoModalBtn) closeMongoModalBtn.addEventListener('click', closeMongoModal);
    if (cancelMongoBtn) cancelMongoBtn.addEventListener('click', closeMongoModal);
    if (closeMongoErrorBtn) {
      closeMongoErrorBtn.addEventListener('click', () => {
        const errBox = document.getElementById('mongoConnectError');
        if (errBox) errBox.style.display = 'none';
      });
    }

    if (btnDisconnectMongo) {
      btnDisconnectMongo.addEventListener('click', async () => {
        const ok = await UI.confirm('Disconnect from MongoDB Atlas? Tasks will be hidden.', {
          title: 'Disconnect MongoDB',
          okText: 'Disconnect',
          danger: true
        });
        if (ok) {
          if (window.VG.MongoSync) await window.VG.MongoSync.disconnect();
          window.VG.App.replaceBoard([], []);
          window.VG.App.updateMongoBadge();
          window.VG.Board.renderBoard();
          closeMongoModal();
          window.VG.App.showToast('Disconnected from MongoDB', 'info');
        }
      });
    }

    if (mongoConnectForm) {
      mongoConnectForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uriInput = document.getElementById('mongoUriInput');
        const uri = (uriInput ? uriInput.value : '').trim();
        const errBox = document.getElementById('mongoConnectError');
        const errText = document.getElementById('mongoConnectErrorText');
        const succBox = document.getElementById('mongoConnectSuccess');
        const succText = document.getElementById('mongoConnectSuccessText');
        const submitBtn = document.getElementById('btnSubmitMongo');

        if (!uri) return;

        if (errBox) errBox.style.display = 'none';
        if (succBox) succBox.style.display = 'none';
        if (submitBtn) submitBtn.classList.add('loading');

        try {
          const res = await window.VG.MongoSync.connect(uri);
          if (submitBtn) submitBtn.classList.remove('loading');
          if (succBox && succText) {
            succBox.style.display = 'block';
            succText.textContent = `Connected! Loading tasks from "${res.database}"...`;
          }
          await window.VG.App.loadFromMongo();
          setTimeout(() => {
            closeMongoModal();
          }, 600);
        } catch (err) {
          if (submitBtn) submitBtn.classList.remove('loading');
          if (errBox && errText) {
            errBox.style.display = 'block';
            errText.textContent = err.message || 'Connection failed';
          }
        }
      });
    }

    // Tab buttons
    const tabBtnAttachments = document.getElementById('tabBtnAttachments');
    const tabBtnComments = document.getElementById('tabBtnComments');
    const tabBtnHistory = document.getElementById('tabBtnHistory');

    if (closeCreateModalBtn) closeCreateModalBtn.addEventListener('click', closeCreateModal);
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', closeCreateModal);
    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);

    UI.initModal(modalCreateOverlay, {
      onVisible: () => {
        if (createDescEditor) createDescEditor.codemirror.refresh();
        document.getElementById('newTaskName').focus();
      }
    });

    UI.initModal(modalEditOverlay, {
      onVisible: () => {
        if (editDescEditor) editDescEditor.codemirror.refresh();
        document.getElementById('editTaskName').focus();
      },
      // Closed by the dimmer, the close icon or Escape
      onHide: () => {
        activeEditingTaskId = null;
      },
      onHidden: () => {
        // Return focus to the card that opened the modal (keyboard users)
        const cardId = lastFocusedCard && lastFocusedCard.getAttribute && lastFocusedCard.getAttribute('data-task-id');
        const restore = restoreFocusOnHide;
        lastFocusedCard = null;
        restoreFocusOnHide = true;
        if (cardId && restore) {
          const card = document.querySelector(`.task-card[data-task-id="${CSS.escape(cardId)}"]`);
          if (card) card.focus();
        }
      }
    });

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

    // Markdown editors for the description fields
    const Markdown = window.VG.Markdown;
    createDescEditor = Markdown.createEditor(document.getElementById('newTaskDesc'), { minHeight: '110px' });
    editDescEditor = Markdown.createEditor(document.getElementById('editTaskDesc'), { minHeight: '130px' });

    // Tag pickers (suggestions while typing, new tags created on save)
    createTagPicker = window.VG.Tags.createPicker(document.getElementById('newTaskTags'));
    editTagPicker = window.VG.Tags.createPicker(document.getElementById('editTaskTags'));

    // Open the full task page, carrying over unsaved edits from the modal
    const btnOpenTaskPage = document.getElementById('btnOpenTaskPage');
    if (btnOpenTaskPage) {
      btnOpenTaskPage.addEventListener('click', () => {
        if (!activeEditingTaskId) return;
        const taskId = activeEditingTaskId;
        const draft = readEditDraft();
        closeEditModal({ restoreFocus: false });
        window.VG.TaskPage.open(taskId, draft);
      });
    }

    // Cmd/Ctrl+Enter saves the edit modal (or posts the comment being written)
    if (modalEditOverlay) {
      modalEditOverlay.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        if (e.target && e.target.id === 'newCommentText') {
          addCommentForm.requestSubmit();
        } else {
          handleSaveTaskDetails();
        }
      });
    }

    // Remember the last comment author
    const authorInput = document.getElementById('newCommentAuthor');
    if (authorInput) {
      try {
        const saved = localStorage.getItem(COMMENT_AUTHOR_KEY);
        if (saved) authorInput.value = saved;
      } catch (e) { /* ignore */ }
    }
  }

  const COMMENT_AUTHOR_KEY = 'vg_task_manager_comment_author';

  /** Updates a tab label without wiping its icon */
  function setTabLabel(tabBtn, text) {
    if (!tabBtn) return;
    const label = tabBtn.querySelector('span');
    if (label) label.textContent = text; else tabBtn.textContent = text;
  }

  function isAnyModalOpen() {
    return UI.isAnyModalVisible();
  }

  function openCreateModal(defaultState = 'planned') {
    const modalCreateOverlay = document.getElementById('modalCreateOverlay');
    const createTaskForm = document.getElementById('createTaskForm');
    const taskStateSelect = document.getElementById('newTaskState');

    if (createTaskForm) createTaskForm.reset();
    if (taskStateSelect) taskStateSelect.value = defaultState;
    window.VG.Markdown.setValue(createDescEditor, document.getElementById('newTaskDesc'), '');
    if (createTagPicker) createTagPicker.setValue([]);

    if (modalCreateOverlay) UI.showModal(modalCreateOverlay);
  }

  function closeCreateModal() {
    const modalCreateOverlay = document.getElementById('modalCreateOverlay');
    if (modalCreateOverlay && UI.isModalVisible(modalCreateOverlay)) UI.hideModal(modalCreateOverlay);
  }

  function openMongoModal() {
    const modal = document.getElementById('modalMongoOverlay');
    const input = document.getElementById('mongoUriInput');
    const errBox = document.getElementById('mongoConnectError');
    const succBox = document.getElementById('mongoConnectSuccess');
    const disconnectBtn = document.getElementById('btnDisconnectMongo');

    if (errBox) errBox.style.display = 'none';
    if (succBox) succBox.style.display = 'none';

    if (input) {
      const stored = window.VG.MongoSync ? window.VG.MongoSync.getStoredUri() : '';
      input.value = stored || (window.VG.MongoSync ? window.VG.MongoSync.DEFAULT_URI : '');
    }

    if (disconnectBtn && window.VG.MongoSync) {
      disconnectBtn.style.display = window.VG.MongoSync.isConnected() ? 'inline-block' : 'none';
    }

    if (modal) UI.showModal(modal);
  }

  function closeMongoModal() {
    const modal = document.getElementById('modalMongoOverlay');
    if (modal && UI.isModalVisible(modal)) UI.hideModal(modal);
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

    const id = window.VG.Constants.generateId('task');
    const now = new Date().toISOString();
    const targetState = canonicalState(stateInput.value);

    const newTask = {
      id,
      name,
      description: window.VG.Markdown.getValue(createDescEditor, descInput).trim(),
      'openspec-id': openspecInput.value.trim(),
      priority: canonicalPriority(prioInput.value),
      status: targetState,
      tags: window.VG.Tags.ensure(createTagPicker ? createTagPicker.getValue() : []),
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
    lastFocusedCard = document.activeElement;
    const modalEditOverlay = document.getElementById('modalEditOverlay');
    if (!modalEditOverlay) return;

    // Set values in modal
    document.getElementById('editTaskIdLabel').textContent = `#${task.id}`;
    document.getElementById('editTaskName').value = task.name || '';
    window.VG.Markdown.setValue(editDescEditor, document.getElementById('editTaskDesc'), task.description || '');
    document.getElementById('editTaskOpenspecId').value = task['openspec-id'] || '';
    document.getElementById('editTaskPriority').value = canonicalPriority(task.priority);
    document.getElementById('editTaskState').value = canonicalState(task.status);
    if (editTagPicker) editTagPicker.setValue(task.tags || []);

    renderAttachmentsTab(task);
    renderCommentsTab(task);
    renderHistoryTab(task);

    // Reset any half-filled attachment upload from a previous task
    const fileInput = document.getElementById('newAttachmentFile');
    if (fileInput) fileInput.value = '';
    resetFileInputLabel();

    switchTab('tabAttachments');
    UI.showModal(modalEditOverlay);
  }

  function closeEditModal({ restoreFocus = true } = {}) {
    const modalEditOverlay = document.getElementById('modalEditOverlay');
    activeEditingTaskId = null;
    if (!modalEditOverlay || !UI.isModalVisible(modalEditOverlay)) return;
    restoreFocusOnHide = restoreFocus;
    UI.hideModal(modalEditOverlay);
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

  /** Current (possibly unsaved) values of the edit modal's task fields */
  function readEditDraft() {
    return {
      name: document.getElementById('editTaskName').value,
      description: window.VG.Markdown.getValue(editDescEditor, document.getElementById('editTaskDesc')),
      'openspec-id': document.getElementById('editTaskOpenspecId').value,
      priority: document.getElementById('editTaskPriority').value,
      status: document.getElementById('editTaskState').value,
      tags: editTagPicker ? editTagPicker.getValue() : undefined
    };
  }

  /**
   * Applies edited fields to a task, recording a status transition when the
   * status changes. Shared by the edit modal and the task page.
   * @returns {string|null} an error message, or null when applied
   */
  function applyTaskEdits(task, fields, reason) {
    const name = (fields.name || '').trim();
    if (!name) return 'Task name cannot be empty.';

    const prevStatus = canonicalState(task.status);
    const newStatus = canonicalState(fields.status);
    const now = new Date().toISOString();

    task.name = name;
    task.description = (fields.description || '').trim();
    task['openspec-id'] = (fields['openspec-id'] || '').trim();
    task.priority = canonicalPriority(fields.priority);
    task.status = newStatus;
    if (fields.tags !== undefined) task.tags = window.VG.Tags.ensure(fields.tags);
    task.updated_at = now;

    if (prevStatus !== newStatus) {
      task.history = task.history || [];
      task.history.push({ from_status: prevStatus, to_status: newStatus, timestamp: now, reason });
    }
    return null;
  }

  function handleSaveTaskDetails() {
    if (!activeEditingTaskId) return;
    const tasks = window.VG.App.getTasks();
    const task = tasks.find(t => t.id === activeEditingTaskId);
    if (!task) return;

    const error = applyTaskEdits(task, readEditDraft(), 'Status changed in task details');
    if (error) {
      UI.toast(error, 'warning');
      document.getElementById('editTaskName').focus();
      return;
    }

    closeEditModal();
    window.VG.App.persistChanges('Task updated successfully');
    window.VG.Board.renderBoard();
  }

  /** Removes a task with its attachments (IndexedDB and MongoDB) */
  async function deleteTask(task) {
    await window.VG.Storage.deleteTaskAttachments(task.id);
    if (window.VG.MongoSync && window.VG.MongoSync.isConnected()) {
      await window.VG.MongoSync.deleteTask(task.id);
    }

    const tasks = window.VG.App.getTasks();
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) tasks.splice(idx, 1);

    window.VG.App.persistChanges('Task deleted');
    window.VG.Board.renderBoard();
  }

  function confirmDeleteTask(task) {
    return UI.confirm(`Delete task "${task.name}"? All its attachments will also be removed.`, {
      title: 'Delete task',
      okText: 'Delete',
      danger: true
    });
  }

  /** Edits an attachment's display name and description; resolves true when changed */
  async function editAttachmentDetails(task, att) {
    const values = await UI.form('Attachment details', [
      { name: 'name', label: 'Display name (optional)', value: att.name || '' },
      { name: 'description', label: 'Description (optional)', value: att.description || '', multiline: true }
    ]);
    if (!values) return false;
    Attachments.updateAttachmentDetails(task, att.id, values.name, values.description);
    return true;
  }

  function confirmDeleteAttachment(att) {
    return UI.confirm(`Delete attachment "${att.filename}"?`, { title: 'Delete attachment', okText: 'Delete', danger: true });
  }

  async function handleDeleteTask() {
    if (!activeEditingTaskId) return;
    const tasks = window.VG.App.getTasks();
    const task = tasks.find(t => t.id === activeEditingTaskId);
    if (!task) return;

    if (await confirmDeleteTask(task)) {
      closeEditModal({ restoreFocus: false });
      await deleteTask(task);
    }
  }

  /* -------------------------------------------------------------
   * ATTACHMENTS TAB RENDERING & HANDLING
   * ------------------------------------------------------------- */

  function renderAttachmentsTab(task) {
    const listEl = document.getElementById('attachmentsList');
    const tabBtn = document.getElementById('tabBtnAttachments');
    const count = task.attachments ? task.attachments.length : 0;

    setTabLabel(tabBtn, `Attachments (${count})`);
    if (!listEl) return;

    if (!task.attachments || task.attachments.length === 0) {
      listEl.innerHTML = `<div class="ui message empty-message">No files attached yet. Upload images, docs, audio, or PDFs below.</div>`;
      return;
    }

    listEl.innerHTML = '';
    task.attachments.forEach(att => {
      const item = document.createElement('div');
      item.className = 'item attachment-item';
      item.innerHTML = `
        <div class="attachment-item-icon"><i class="big grey ${getFileIcon(att.filename)} icon" title="${escapeHtml(att.type || 'file')}"></i></div>
        <div class="middle aligned content">
          <div class="header" title="${escapeHtml(att.filename)}">${escapeHtml(att.filename)}</div>
          ${att.name ? `<div class="meta">${escapeHtml(att.name)}</div>` : ''}
          ${att.description ? `<div class="description">${escapeHtml(att.description)}</div>` : ''}
          <div class="extra">
            ${formatFileSize(att.size)} · ${formatRelativeTime(att.created_at)}
            <div class="ui right floated mini basic inverted icon buttons">
              <button type="button" class="ui button" data-action="open" title="Open or download file" aria-label="Open file"><i class="external alternate icon"></i></button>
              <button type="button" class="ui button" data-action="edit" title="Edit name & description" aria-label="Edit details"><i class="pencil alternate icon"></i></button>
              <button type="button" class="ui button" data-action="delete" title="Delete attachment" aria-label="Delete attachment"><i class="red trash alternate outline icon"></i></button>
            </div>
          </div>
        </div>
      `;

      item.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        if (action === 'open') {
          Attachments.openOrDownloadAttachment(task, att);
        } else if (action === 'edit') {
          if (await editAttachmentDetails(task, att)) {
            renderAttachmentsTab(task);
            window.VG.App.persistChanges('Attachment details updated');
          }
        } else if (action === 'delete') {
          if (await confirmDeleteAttachment(att)) {
            await Attachments.deleteAttachmentFromTask(task, att.id);
            renderAttachmentsTab(task);
            window.VG.Board.renderBoard();
            window.VG.App.persistChanges('Attachment deleted');
          }
        }
      });

      listEl.appendChild(item);
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
          UI.toast('Select a file to attach first.', 'warning');
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
          UI.toast('Error adding attachment: ' + err.message, 'error', 6000);
        }
      });
    }
  }

  function updateFileInputLabel(file) {
    const label = document.querySelector('.attachment-drop-text');
    if (label && file) {
      label.innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${formatFileSize(file.size)}) · <a>change</a>`;
    }
  }

  function resetFileInputLabel() {
    const label = document.querySelector('.attachment-drop-text');
    if (label) {
      label.innerHTML = 'Drag & drop a file here or <a>browse from computer</a>';
    }
  }

  /* -------------------------------------------------------------
   * COMMENTS & HISTORY TAB RENDERING
   * ------------------------------------------------------------- */

  function renderCommentsTab(task) {
    const listEl = document.getElementById('commentsList');
    const tabBtn = document.getElementById('tabBtnComments');
    const count = task.comments ? task.comments.length : 0;

    setTabLabel(tabBtn, `Comments (${count})`);
    renderCommentList(listEl, task);
  }

  function renderCommentList(listEl, task) {
    if (!listEl) return;

    if (!task.comments || task.comments.length === 0) {
      listEl.innerHTML = `<div class="ui message empty-message">No comments yet. Add one below.</div>`;
      return;
    }

    listEl.innerHTML = task.comments.map(c => `
      <div class="comment">
        <div class="avatar comment-avatar"><i class="big grey user circle icon"></i></div>
        <div class="content">
          <span class="author">${escapeHtml(c.author || 'User')}</span>
          <div class="metadata">
            <span class="date" title="${escapeHtml(new Date(c.timestamp).toLocaleString())}">${formatRelativeTime(c.timestamp)}</span>
          </div>
          <div class="text">${escapeHtml(c.text)}</div>
        </div>
      </div>
    `).join('');
  }

  /** Appends a comment and remembers its author for next time */
  function addComment(task, author, text) {
    const authorName = (author || '').trim();
    try { localStorage.setItem(COMMENT_AUTHOR_KEY, authorName); } catch (err) { /* ignore */ }

    const now = new Date().toISOString();
    task.comments = task.comments || [];
    task.comments.push({
      id: window.VG.Constants.generateId('comm'),
      author: authorName || 'User',
      text: text.trim(),
      timestamp: now
    });
    task.updated_at = now;
  }

  function getSavedCommentAuthor() {
    try { return localStorage.getItem(COMMENT_AUTHOR_KEY) || ''; } catch (e) { return ''; }
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

    addComment(task, authorInput.value, text);
    textInput.value = '';
    renderCommentsTab(task);
    window.VG.Board.renderBoard();
    window.VG.App.persistChanges('Comment added');
  }

  function renderHistoryTab(task) {
    const timelineEl = document.getElementById('historyTimeline');
    const tabBtn = document.getElementById('tabBtnHistory');
    const count = task.history ? task.history.length : 0;

    setTabLabel(tabBtn, `History (${count})`);
    renderHistoryList(timelineEl, task);
  }

  function renderHistoryList(timelineEl, task) {
    if (!timelineEl) return;

    if (!task.history || task.history.length === 0) {
      timelineEl.innerHTML = `<div class="ui message empty-message">No history recorded.</div>`;
      return;
    }

    const stateMeta = (id) => STATES.find(st => st.id === id);
    timelineEl.innerHTML = task.history.slice().reverse().map(h => {
      const from = h.from_status ? stateMeta(h.from_status) : null;
      const to = stateMeta(h.to_status) || { label: h.to_status, icon: 'circle', color: 'grey' };
      const fromLbl = h.from_status ? escapeHtml(from ? from.label : h.from_status) : 'Created';
      return `
        <div class="event">
          <div class="label"><i class="${to.icon} ${to.color} icon"></i></div>
          <div class="content">
            <div class="summary">
              ${fromLbl} <i class="long arrow alternate right icon"></i> <strong>${escapeHtml(to.label)}</strong>
              <div class="date" title="${escapeHtml(new Date(h.timestamp).toLocaleString())}">${formatRelativeTime(h.timestamp)}</div>
            </div>
            ${h.reason ? `<div class="extra text">${escapeHtml(h.reason)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  window.VG.Modals = {
    initModals,
    openCreateModal,
    closeCreateModal,
    openEditModal,
    closeEditModal,
    openMongoModal,
    closeMongoModal,
    isAnyModalOpen,
    switchTab,
    applyTaskEdits,
    deleteTask,
    confirmDeleteTask,
    editAttachmentDetails,
    confirmDeleteAttachment,
    addComment,
    getSavedCommentAuthor,
    renderCommentList,
    renderHistoryList
  };
})();
