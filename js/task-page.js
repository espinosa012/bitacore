/**
 * vg-task-manager: Task Page (route #/task/<id>)
 *
 * Full-page view of a single task: editable title and fields, a markdown
 * description editor, attachments with inline previews, comments and history.
 * Field edits are a draft until saved; attachments and comments apply at once,
 * like in the edit modal.
 */
(function() {
  window.VG = window.VG || {};
  const { STATES, PRIORITIES, canonicalState, canonicalPriority, escapeHtml, formatRelativeTime, formatFileSize, getFileIcon } = window.VG.Constants;
  const Storage = window.VG.Storage;
  const Attachments = window.VG.Attachments;
  const Markdown = window.VG.Markdown;

  const ROUTE_PREFIX = '#/task/';
  const BASE_TITLE = document.title;
  const TEXT_PREVIEW_BYTES = 4096;

  let currentTaskId = null;
  let descEditor = null;
  let pendingDraft = null;       // fields carried over from the edit modal
  let cameFromBoard = false;     // true when history.back() returns to the board
  let ignoreNextHashChange = false;
  let objectUrls = [];
  let renderToken = 0;           // discards async previews of a previous render

  const el = (id) => document.getElementById(id);

  function isOpen() {
    return currentTaskId !== null;
  }

  function getCurrentTask() {
    return window.VG.App.getTasks().find(t => t.id === currentTaskId) || null;
  }

  function taskIdFromHash() {
    const hash = window.location.hash;
    if (!hash.startsWith(ROUTE_PREFIX)) return null;
    try {
      return decodeURIComponent(hash.slice(ROUTE_PREFIX.length));
    } catch (e) {
      return null;
    }
  }

  /* -------------------------------------------------------------
   * DRAFT FIELDS
   * ------------------------------------------------------------- */

  function readFields() {
    return {
      name: el('pageTaskName').value,
      description: Markdown.getValue(descEditor, el('pageTaskDesc')),
      'openspec-id': el('pageTaskOpenspecId').value,
      priority: el('pageTaskPriority').value,
      status: el('pageTaskState').value
    };
  }

  function normalizeFields(f) {
    return {
      name: (f.name || '').trim(),
      description: (f.description || '').trim(),
      'openspec-id': (f['openspec-id'] || '').trim(),
      priority: canonicalPriority(f.priority),
      status: canonicalState(f.status)
    };
  }

  function isDirty() {
    const task = isOpen() && getCurrentTask();
    if (!task) return false;
    const a = normalizeFields(readFields());
    const b = normalizeFields(task);
    return Object.keys(a).some(k => a[k] !== b[k]);
  }

  function updateDirtyState() {
    const dirty = isDirty();
    el('pageDirtyBadge').hidden = !dirty;
    el('pageSaveBtn').disabled = !dirty;
    el('pageRevertBtn').disabled = !dirty;
  }

  function fillFields(fields) {
    el('pageTaskName').value = fields.name || '';
    el('pageTaskOpenspecId').value = fields['openspec-id'] || '';
    el('pageTaskPriority').value = canonicalPriority(fields.priority);
    el('pageTaskState').value = canonicalState(fields.status);
    Markdown.setValue(descEditor, el('pageTaskDesc'), fields.description || '');

    // Show the rendered description first; double-click or the toolbar edits it
    if (descEditor && (fields.description || '').trim() && !descEditor.isPreviewActive()) {
      window.EasyMDE.togglePreview(descEditor);
    }
  }

  /* -------------------------------------------------------------
   * NAVIGATION
   * ------------------------------------------------------------- */

  /** Opens the page for a task; `draft` pre-fills unsaved field edits */
  function open(taskId, draft = null) {
    pendingDraft = draft;
    cameFromBoard = !isOpen();
    const target = ROUTE_PREFIX + encodeURIComponent(taskId);
    if (window.location.hash === target) {
      route();
    } else {
      window.location.hash = target;
    }
  }

  function confirmDiscard() {
    return !isDirty() || confirm('You have unsaved changes on this task. Discard them?');
  }

  /** Back to the board, asking first when there are unsaved edits */
  function close() {
    if (!confirmDiscard()) return;
    leaveToBoard();
  }

  function leaveToBoard() {
    if (cameFromBoard && window.history.length > 1) {
      ignoreNextHashChange = true;
      showBoard();
      window.history.back();
    } else {
      window.history.pushState(null, '', window.location.pathname + window.location.search);
      showBoard();
    }
  }

  function onHashChange() {
    if (ignoreNextHashChange) {
      ignoreNextHashChange = false;
      return;
    }
    const nextId = taskIdFromHash();
    if (isOpen() && nextId !== currentTaskId && !confirmDiscard()) {
      // Stay on the task: restore its URL without adding a history entry
      window.history.replaceState(null, '', ROUTE_PREFIX + encodeURIComponent(currentTaskId));
      return;
    }
    route();
  }

  function route() {
    const taskId = taskIdFromHash();
    if (taskId === null) {
      showBoard();
      return;
    }

    const task = window.VG.App.getTasks().find(t => t.id === taskId);
    if (!task) {
      window.VG.App.showToast('That task is not on the board. Load its folder or ZIP first.', 'warning', 5000);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      showBoard();
      return;
    }
    showTask(task);
  }

  function showTask(task) {
    const switching = currentTaskId !== task.id;
    currentTaskId = task.id;

    if (window.VG.Modals) {
      window.VG.Modals.closeCreateModal();
      window.VG.Modals.closeEditModal({ restoreFocus: false });
    }

    document.body.classList.add('view-task');
    document.querySelector('main').hidden = true;
    el('taskPage').hidden = false;

    el('pageTaskIdLabel').textContent = `#${task.id}`;
    fillFields(pendingDraft ? { ...task, ...pendingDraft } : task);
    pendingDraft = null;

    renderAttachments(task);
    renderComments(task);
    renderSidebar(task);
    updateDirtyState();

    document.title = `${task.name} · ${BASE_TITLE}`;
    if (switching) {
      window.scrollTo(0, 0);
      setTimeout(() => descEditor && descEditor.codemirror.refresh(), 60);
    }
  }

  function showBoard() {
    if (descEditor && descEditor.isFullscreenActive && descEditor.isFullscreenActive()) {
      window.EasyMDE.toggleFullScreen(descEditor);
    }
    currentTaskId = null;
    pendingDraft = null;
    revokeObjectUrls();
    document.body.classList.remove('view-task');
    el('taskPage').hidden = true;
    document.querySelector('main').hidden = false;
    document.title = BASE_TITLE;
    if (window.VG.Board) window.VG.Board.renderBoard();
  }

  /** The board was replaced (import, folder, clear): the open task may be gone */
  function onTasksReplaced() {
    if (!isOpen()) return;
    const task = getCurrentTask();
    if (task) {
      showTask(task);
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      showBoard();
    }
  }

  /* -------------------------------------------------------------
   * ACTIONS
   * ------------------------------------------------------------- */

  function save() {
    const task = getCurrentTask();
    if (!task || !isDirty()) return;

    const error = window.VG.Modals.applyTaskEdits(task, readFields(), 'Status changed on task page');
    if (error) {
      alert(error);
      el('pageTaskName').focus();
      return;
    }

    window.VG.App.persistChanges('Task updated successfully');
    document.title = `${task.name} · ${BASE_TITLE}`;
    renderSidebar(task);
    updateDirtyState();
  }

  function revert() {
    const task = getCurrentTask();
    if (!task) return;
    fillFields(task);
    updateDirtyState();
  }

  async function remove() {
    const task = getCurrentTask();
    if (!task) return;
    if (!confirm(`Are you sure you want to delete task "${task.name}"? All attachments will also be removed.`)) return;

    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    showBoard();
    await window.VG.Modals.deleteTask(task);
  }

  async function addFiles(fileList) {
    const task = getCurrentTask();
    const files = Array.from(fileList || []);
    if (!task || files.length === 0) return;

    let added = 0;
    for (const file of files) {
      try {
        await Attachments.addAttachmentToTask(task, file);
        added++;
      } catch (err) {
        window.VG.App.showToast(`Could not attach ${file.name}: ${err.message}`, 'error', 6000);
      }
    }
    if (added === 0) return;

    renderAttachments(task);
    renderSidebar(task);
    window.VG.App.persistChanges(added === 1 ? `Attached ${files[0].name}` : `Attached ${added} files`);
  }

  function postComment(e) {
    e.preventDefault();
    const task = getCurrentTask();
    const textInput = el('pageCommentText');
    const text = textInput.value.trim();
    if (!task || !text) return;

    window.VG.Modals.addComment(task, el('pageCommentAuthor').value, text);
    textInput.value = '';
    renderComments(task);
    renderSidebar(task);
    window.VG.App.persistChanges('Comment added');
  }

  /* -------------------------------------------------------------
   * RENDERING
   * ------------------------------------------------------------- */

  function revokeObjectUrls() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls = [];
  }

  function makeObjectUrl(blob, type) {
    const url = URL.createObjectURL(type ? new Blob([blob], { type }) : blob);
    objectUrls.push(url);
    return url;
  }

  function renderAttachments(task) {
    const grid = el('pageAttachmentsGrid');
    const list = task.attachments || [];
    const totalSize = list.reduce((sum, a) => sum + (a.size || 0), 0);
    el('pageAttachmentsTitle').textContent = list.length
      ? `Attachments (${list.length} · ${formatFileSize(totalSize)})`
      : 'Attachments';

    revokeObjectUrls();
    const token = ++renderToken;
    grid.innerHTML = '';

    if (list.length === 0) {
      grid.innerHTML = '<div class="attachment-empty">No files attached yet. Drop files below or use "Add files".</div>';
      return;
    }

    list.forEach(att => {
      const card = document.createElement('article');
      card.className = 'page-attachment';
      const title = att.name && att.name !== att.filename ? att.name : '';
      card.innerHTML = `
        <div class="page-attachment-preview" data-preview>
          <span class="page-attachment-icon">${getFileIcon(att.filename)}</span>
        </div>
        <div class="page-attachment-body">
          ${title ? `<div class="page-attachment-title">${escapeHtml(title)}</div>` : ''}
          <div class="attachment-filename" title="${escapeHtml(att.filename)}">${escapeHtml(att.filename)}</div>
          ${att.description ? `<div class="attachment-desc">${escapeHtml(att.description)}</div>` : ''}
          <div class="attachment-meta">
            <span>${formatFileSize(att.size)}</span>
            <span>·</span>
            <span>${escapeHtml(att.type || 'unknown type')}</span>
            <span>·</span>
            <span title="${escapeHtml(new Date(att.created_at).toLocaleString())}">${formatRelativeTime(att.created_at)}</span>
          </div>
        </div>
        <div class="page-attachment-actions">
          <button type="button" class="attachment-btn" data-action="open" title="Open in a new tab">Open</button>
          <button type="button" class="attachment-btn attachment-btn-download" data-action="download" title="Download file">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          </button>
          <button type="button" class="attachment-btn" data-action="edit" title="Edit name & description">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button type="button" class="attachment-btn attachment-btn-delete" data-action="delete" title="Delete attachment">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      `;

      const viewType = Attachments.getSafeViewType(att);
      const openBtn = card.querySelector('[data-action="open"]');
      if (!viewType) openBtn.hidden = true;

      card.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        const preview = e.target.closest('[data-preview]');
        if (!btn && !(preview && viewType)) return;
        const action = btn ? btn.getAttribute('data-action') : 'open';

        if (action === 'open') {
          Attachments.openOrDownloadAttachment(task, att);
        } else if (action === 'download') {
          Attachments.openOrDownloadAttachment(task, att, true);
        } else if (action === 'edit') {
          const newName = prompt('Attachment display name (optional):', att.name || '');
          if (newName === null) return;
          const newDesc = prompt('Attachment description (optional):', att.description || '');
          if (newDesc === null) return;
          Attachments.updateAttachmentDetails(task, att.id, newName, newDesc);
          renderAttachments(task);
          window.VG.App.persistChanges('Attachment details updated');
        } else if (action === 'delete') {
          if (!confirm(`Delete attachment "${att.filename}"?`)) return;
          await Attachments.deleteAttachmentFromTask(task, att.id);
          renderAttachments(task);
          renderSidebar(task);
          window.VG.App.persistChanges('Attachment deleted');
        }
      });

      grid.appendChild(card);
      loadPreview(task, att, viewType, card.querySelector('[data-preview]'), token);
    });
  }

  /** Fills an attachment's preview area from its stored blob */
  async function loadPreview(task, att, viewType, container, token) {
    const blob = await Storage.getAttachmentBlob(task.id, att.filename);
    if (token !== renderToken) return;

    if (!blob) {
      container.classList.add('is-missing');
      container.insertAdjacentHTML('beforeend', '<span class="page-attachment-missing">Not available locally</span>');
      return;
    }

    const type = (att.type || '').toLowerCase();
    if (viewType && viewType.startsWith('image/')) {
      const img = document.createElement('img');
      img.alt = att.name || att.filename;
      img.loading = 'lazy';
      img.src = makeObjectUrl(blob, viewType);
      container.replaceChildren(img);
      container.classList.add('is-clickable');
    } else if (viewType && viewType.startsWith('text/')) {
      const text = await blob.slice(0, TEXT_PREVIEW_BYTES).text();
      if (token !== renderToken) return;
      const pre = document.createElement('pre');
      pre.textContent = text + (blob.size > TEXT_PREVIEW_BYTES ? '\n…' : '');
      container.replaceChildren(pre);
      container.classList.add('is-text', 'is-clickable');
    } else if (type.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = makeObjectUrl(blob, type);
      container.appendChild(audio);
      container.classList.add('is-media');
    } else if (type.startsWith('video/')) {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.src = makeObjectUrl(blob, type);
      container.replaceChildren(video);
      container.classList.add('is-media');
    } else if (viewType) {
      container.classList.add('is-clickable');
    }
  }

  function renderComments(task) {
    const count = (task.comments || []).length;
    el('pageCommentsTitle').textContent = count ? `Comments (${count})` : 'Comments';
    window.VG.Modals.renderCommentList(el('pageCommentsList'), task);
  }

  function renderSidebar(task) {
    const count = (task.history || []).length;
    el('pageHistoryTitle').textContent = count ? `History (${count})` : 'History';
    window.VG.Modals.renderHistoryList(el('pageHistoryTimeline'), task);

    const dateCell = (iso) => iso
      ? `<span title="${escapeHtml(new Date(iso).toLocaleString())}">${formatRelativeTime(iso)}</span>`
      : '—';
    el('pageTaskMeta').innerHTML = `
      <div><dt>Created</dt><dd>${dateCell(task.created_at)}</dd></div>
      <div><dt>Updated</dt><dd>${dateCell(task.updated_at)}</dd></div>
      <div><dt>Attachments</dt><dd>${(task.attachments || []).length}</dd></div>
      <div><dt>Comments</dt><dd>${(task.comments || []).length}</dd></div>
    `;
  }

  /* -------------------------------------------------------------
   * SETUP
   * ------------------------------------------------------------- */

  function fillSelects() {
    el('pageTaskState').innerHTML = STATES
      .map(st => `<option value="${escapeHtml(st.id)}">${st.icon} ${escapeHtml(st.label)}</option>`)
      .join('');
    el('pageTaskPriority').innerHTML = Object.entries(PRIORITIES)
      .map(([id, meta]) => `<option value="${escapeHtml(id)}">${escapeHtml(meta.label)}</option>`)
      .join('');
  }

  function init() {
    if (!el('taskPage')) return;
    fillSelects();

    descEditor = Markdown.createEditor(el('pageTaskDesc'), { full: true, minHeight: '220px' });
    if (descEditor) {
      descEditor.codemirror.on('change', updateDirtyState);
      // Double-click the rendered description to edit it
      descEditor.codemirror.getWrapperElement().parentNode.addEventListener('dblclick', (e) => {
        if (e.target.closest('.editor-preview-active') && descEditor.isPreviewActive()) {
          window.EasyMDE.togglePreview(descEditor);
          descEditor.codemirror.focus();
        }
      });
    } else {
      el('pageTaskDesc').classList.add('form-control');
      el('pageTaskDesc').addEventListener('input', updateDirtyState);
    }

    ['pageTaskName', 'pageTaskOpenspecId'].forEach(id => el(id).addEventListener('input', updateDirtyState));
    ['pageTaskState', 'pageTaskPriority'].forEach(id => el(id).addEventListener('change', updateDirtyState));

    el('pageBackBtn').addEventListener('click', close);
    el('pageSaveBtn').addEventListener('click', save);
    el('pageRevertBtn').addEventListener('click', revert);
    el('pageDeleteBtn').addEventListener('click', remove);
    el('pageTaskName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });

    // Attachments: picker and drop zone (multiple files)
    const fileInput = el('pageFileInput');
    const dropZone = el('pageDropZone');
    el('pageAddFilesBtn').addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      addFiles(fileInput.files);
      fileInput.value = '';
    });
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-active');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-active'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation(); // not a board import
      dropZone.classList.remove('drag-active');
      if (e.dataTransfer) addFiles(e.dataTransfer.files);
    });

    // Comments
    el('pageCommentAuthor').value = window.VG.Modals.getSavedCommentAuthor() || 'OpenCode';
    el('pageCommentForm').addEventListener('submit', postComment);
    el('pageCommentText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        el('pageCommentForm').requestSubmit();
      }
    });

    // Ctrl/Cmd+S and Ctrl/Cmd+Enter save the task fields
    el('taskPage').addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const isSave = e.key === 's' || e.key === 'S' || (e.key === 'Enter' && e.target.id !== 'pageCommentText');
      if (isSave) {
        e.preventDefault();
        save();
      }
    });

    window.addEventListener('hashchange', onHashChange);
  }

  window.VG.TaskPage = {
    init,
    open,
    close,
    route,
    isOpen,
    isDirty,
    onTasksReplaced
  };
})();
