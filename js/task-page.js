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
  const UI = window.VG.UI;

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

  async function confirmDiscard() {
    return !isDirty() || UI.confirm('You have unsaved changes on this task. Discard them?', {
      title: 'Unsaved changes',
      okText: 'Discard',
      danger: true
    });
  }

  /** Back to the board, asking first when there are unsaved edits */
  async function close() {
    if (!(await confirmDiscard())) return;
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

  async function onHashChange() {
    if (ignoreNextHashChange) {
      ignoreNextHashChange = false;
      return;
    }
    const nextId = taskIdFromHash();
    if (isOpen() && nextId !== currentTaskId && isDirty()) {
      // Stay on the task while asking: restore its URL without a new history entry
      const targetUrl = window.location.href;
      window.history.replaceState(null, '', ROUTE_PREFIX + encodeURIComponent(currentTaskId));
      if (!(await confirmDiscard())) return;
      window.history.replaceState(null, '', targetUrl);
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
      UI.toast('That task is not on the board. Load its folder or ZIP first.', 'warning', 5000);
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
      UI.toast(error, 'warning');
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
    if (!(await window.VG.Modals.confirmDeleteTask(task))) return;

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
        UI.toast(`Could not attach ${file.name}: ${err.message}`, 'error', 6000);
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
      grid.innerHTML = '<div class="ui fluid message empty-message">No files attached yet. Drop files below or use "Add files".</div>';
      return;
    }

    list.forEach(att => {
      const card = document.createElement('div');
      card.className = 'card page-attachment';
      const title = att.name && att.name !== att.filename ? att.name : '';
      card.innerHTML = `
        <div class="image page-attachment-preview" data-preview>
          <i class="huge grey ${getFileIcon(att.filename)} icon"></i>
        </div>
        <div class="content">
          <div class="header page-attachment-title" title="${escapeHtml(att.filename)}">${escapeHtml(title || att.filename)}</div>
          ${title ? `<div class="meta">${escapeHtml(att.filename)}</div>` : ''}
          ${att.description ? `<div class="description">${escapeHtml(att.description)}</div>` : ''}
        </div>
        <div class="extra content">
          <span title="${escapeHtml(att.type || 'unknown type')}">${formatFileSize(att.size)}</span>
          · <span title="${escapeHtml(new Date(att.created_at).toLocaleString())}">${formatRelativeTime(att.created_at)}</span>
        </div>
        <div class="ui bottom attached four mini basic buttons">
          <button type="button" class="ui icon button" data-action="open" title="Open in a new tab" aria-label="Open"><i class="external alternate icon"></i></button>
          <button type="button" class="ui icon button" data-action="download" title="Download file" aria-label="Download"><i class="download icon"></i></button>
          <button type="button" class="ui icon button" data-action="edit" title="Edit name & description" aria-label="Edit details"><i class="pencil alternate icon"></i></button>
          <button type="button" class="ui icon button" data-action="delete" title="Delete attachment" aria-label="Delete"><i class="red trash alternate outline icon"></i></button>
        </div>
      `;

      const viewType = Attachments.getSafeViewType(att);
      const openBtn = card.querySelector('[data-action="open"]');
      if (!viewType) openBtn.classList.add('disabled');

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
          if (!(await window.VG.Modals.editAttachmentDetails(task, att))) return;
          renderAttachments(task);
          window.VG.App.persistChanges('Attachment details updated');
        } else if (action === 'delete') {
          if (!(await window.VG.Modals.confirmDeleteAttachment(att))) return;
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
      container.insertAdjacentHTML('beforeend', '<span class="ui mini basic label page-attachment-missing">Not available locally</span>');
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
    const stat = (label, value) => `
      <div class="column">
        <div class="ui mini statistic task-page-stat">
          <div class="value">${value}</div>
          <div class="label">${label}</div>
        </div>
      </div>`;
    el('pageTaskMeta').innerHTML = [
      stat('Created', dateCell(task.created_at)),
      stat('Updated', dateCell(task.updated_at)),
      stat('Attachments', (task.attachments || []).length),
      stat('Comments', (task.comments || []).length)
    ].join('');
  }

  /* -------------------------------------------------------------
   * SETUP
   * ------------------------------------------------------------- */

  function fillSelects() {
    el('pageTaskState').innerHTML = STATES
      .map(st => `<option value="${escapeHtml(st.id)}">${escapeHtml(st.label)}</option>`)
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
