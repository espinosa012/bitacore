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
  const { STATES, PRIORITIES, TASK_TYPES, canonicalState, canonicalPriority, canonicalTaskType, escapeHtml, formatRelativeTime, formatFileSize, getFileIcon, validateSubtaskRelationship, getEligibleSubtasks, linkTasks, unlinkTasks, formatTaskId } = window.VG.Constants;
  const Storage = window.VG.Storage;
  const Attachments = window.VG.Attachments;
  const Markdown = window.VG.Markdown;
  const UI = window.VG.UI;

  const ROUTE_PREFIX = '#/task/';
  const BASE_TITLE = document.title;
  const TEXT_PREVIEW_BYTES = 4096;

  let currentTaskId = null;
  let descEditor = null;
  let commentEditor = null;
  let tagPicker = null;
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
      type: el('pageTaskType') ? el('pageTaskType').value : 'task',
      priority: el('pageTaskPriority').value,
      status: el('pageTaskState').value,
      favorite: el('pageTaskFavorite') ? el('pageTaskFavorite').checked : false,
      assignee: el('pageTaskAssignee') ? el('pageTaskAssignee').value : '',
      tags: tagPicker ? tagPicker.getValue() : undefined
    };
  }

  function normalizeFields(f) {
    return {
      name: (f.name || '').trim(),
      description: (f.description || '').trim(),
      'openspec-id': (f['openspec-id'] || '').trim(),
      type: canonicalTaskType(f.type),
      priority: canonicalPriority(f.priority),
      status: canonicalState(f.status),
      favorite: Boolean(f.favorite),
      assignee: (f.assignee && f.assignee.trim()) || '',
      tags: (f.tags || []).map(t => t.toLowerCase()).join('\n')
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

  function updatePageFavBtn() {
    const isFav = el('pageTaskFavorite') ? el('pageTaskFavorite').checked : false;
    const btn = el('pageFavBtn');
    const label = el('pageFavBtnText');
    if (btn) {
      btn.classList.toggle('yellow', isFav);
      btn.classList.toggle('active', isFav);
      btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      btn.title = isFav ? 'Remove highlight (Favorite)' : 'Highlight task (Favorite)';
      const icon = btn.querySelector('i.icon');
      if (icon) icon.className = isFav ? 'star yellow icon' : 'star outline icon';
    }
    if (label) {
      label.textContent = isFav ? 'Highlighted' : 'Highlight';
    }
  }

  function fillFields(fields) {
    el('pageTaskName').value = fields.name || '';
    el('pageTaskOpenspecId').value = fields['openspec-id'] || '';
    if (el('pageTaskType')) el('pageTaskType').value = canonicalTaskType(fields.type);
    el('pageTaskPriority').value = canonicalPriority(fields.priority);
    el('pageTaskState').value = canonicalState(fields.status);
    if (el('pageTaskFavorite')) el('pageTaskFavorite').checked = Boolean(fields.favorite);
    updatePageFavBtn();
    if (el('pageTaskAssignee')) el('pageTaskAssignee').value = fields.assignee || '';
    if (el('pageTaskReporterLabel')) el('pageTaskReporterLabel').textContent = fields.reporter || '—';
    if (tagPicker) tagPicker.setValue(fields.tags || []);
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
    if (Attachments && Attachments.closeImageViewer) Attachments.closeImageViewer();
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

    renderParentBanner(task);
    renderLinkedTasks(task);
    renderSubtasks(task);
    renderAttachments(task);
    renderComments(task);
    renderSidebar(task);
    updateDirtyState();

    document.title = `${task.name} · ${BASE_TITLE}`;
    if (switching) {
      window.scrollTo(0, 0);
      setTimeout(() => descEditor && descEditor.codemirror.refresh(), 60);
      if (commentEditor) {
        Markdown.setValue(commentEditor, el('pageCommentText'), '');
        if (commentEditor.isPreviewActive && commentEditor.isPreviewActive()) {
          window.EasyMDE.togglePreview(commentEditor);
        }
      }
    }
  }

  function showBoard() {
    if (descEditor && descEditor.isFullscreenActive && descEditor.isFullscreenActive()) {
      window.EasyMDE.toggleFullScreen(descEditor);
    }
    if (commentEditor && commentEditor.isPreviewActive && commentEditor.isPreviewActive()) {
      window.EasyMDE.togglePreview(commentEditor);
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
    renderParentBanner(task);
    renderLinkedTasks(task);
    renderSubtasks(task);
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
    if (e && e.preventDefault) e.preventDefault();
    const task = getCurrentTask();
    const textInput = el('pageCommentText');
    const text = (commentEditor ? Markdown.getValue(commentEditor, textInput) : textInput.value).trim();
    if (!task || !text) return;

    const currentUser = window.VG.Auth && window.VG.Auth.getCurrentUser();
    const authorName = (currentUser && currentUser.username) ? currentUser.username : (el('pageCommentAuthor').value || 'User');

    window.VG.Modals.addComment(task, authorName, text);
    if (commentEditor) {
      Markdown.setValue(commentEditor, textInput, '');
    } else {
      textInput.value = '';
    }
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
      const viewType = Attachments.getSafeViewType(att);
      const isImage = viewType && viewType.startsWith('image/');
      const openTitle = isImage ? 'Ver en grande' : 'Open in a new tab';
      const openIcon = isImage ? 'expand' : 'external alternate';

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
          ${att.uploader ? `<span style="color:#8be9fd; margin-right:4px;"><i class="user outline icon"></i>${escapeHtml(att.uploader)}</span> · ` : ''}<span title="${escapeHtml(att.type || 'unknown type')}">${formatFileSize(att.size)}</span>
          · <span title="${escapeHtml(new Date(att.created_at).toLocaleString())}">${formatRelativeTime(att.created_at)}</span>
        </div>
        <div class="ui bottom attached four mini basic inverted buttons">
          <button type="button" class="ui icon button" data-action="open" title="${openTitle}" aria-label="${openTitle}"><i class="${openIcon} icon"></i></button>
          <button type="button" class="ui icon button" data-action="download" title="Download file" aria-label="Download"><i class="download icon"></i></button>
          <button type="button" class="ui icon button" data-action="edit" title="Edit name & description" aria-label="Edit details"><i class="pencil alternate icon"></i></button>
          <button type="button" class="ui icon button" data-action="delete" title="Delete attachment" aria-label="Delete"><i class="red trash alternate outline icon"></i></button>
        </div>
      `;

      const openBtn = card.querySelector('[data-action="open"]');
      if (!viewType) openBtn.classList.add('disabled');

      card.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        const preview = e.target.closest('[data-preview]');
        if (!btn && !(preview && viewType)) return;
        const action = btn ? btn.getAttribute('data-action') : 'open';

        if (action === 'open') {
          if (isImage) {
            Attachments.showImageAttachment(task, att.id || att.filename);
          } else {
            Attachments.openOrDownloadAttachment(task, att);
          }
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
    const blob = await Attachments.getAttachmentBlob(task, att);
    if (token !== renderToken) return;

    if (!blob) {
      container.classList.add('is-missing');
      container.insertAdjacentHTML('beforeend', '<span class="ui mini basic inverted label page-attachment-missing">Not available</span>');
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
      container.title = 'Clic para ver en grande';
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
        <div class="ui mini inverted statistic task-page-stat">
          <div class="value">${value}</div>
          <div class="label">${label}</div>
        </div>
      </div>`;
    el('pageTaskMeta').innerHTML = [
      stat('Created', dateCell(task.created_at)),
      stat('Updated', dateCell(task.updated_at)),
      stat('Reporter', task.reporter ? escapeHtml(task.reporter) : '—'),
      stat('Attachments', (task.attachments || []).length),
      stat('Comments', (task.comments || []).length)
    ].join('');
  }

  function renderParentBanner(task) {
    const banner = el('pageTaskParentBanner');
    const link = el('pageTaskParentLink');
    const status = el('pageTaskParentStatus');
    const unlinkBtn = el('btnPageUnlinkParent');
    if (!banner) return;

    if (task.parentId) {
      const allTasks = window.VG.App.getTasks();
      const parentTask = allTasks.find(t => t.id === task.parentId);
      if (parentTask) {
        banner.style.display = 'block';
        if (link) {
          link.textContent = `#${formatTaskId(parentTask.id)}: ${parentTask.name}`;
          link.onclick = () => open(parentTask.id);
        }
        if (status) {
          const pSt = canonicalState(parentTask.status);
          const pColor = STATES.find(s => s.id === pSt)?.color || 'grey';
          status.textContent = parentTask.status;
          status.className = `ui mini ${pColor} label`;
        }
        if (unlinkBtn) {
          unlinkBtn.onclick = () => {
            task.parentId = null;
            window.VG.App.persistChanges('Subtask unlinked');
            renderParentBanner(task);
            if (window.VG.Board) window.VG.Board.renderBoard();
          };
        }
      } else {
        banner.style.display = 'none';
      }
    } else {
      banner.style.display = 'none';
    }
  }

  function renderLinkedTasks(task) {
    const listEl = el('pageLinkedTasksList');
    const titleEl = el('pageLinkedTasksTitle');
    const linkSelect = el('pageLinkTaskSelect');
    if (!listEl) return;

    const allTasks = window.VG.App.getTasks();
    const linkedIds = Array.isArray(task.linkedTaskIds) ? task.linkedTaskIds : [];
    const linkedTasks = linkedIds.map(id => allTasks.find(t => t.id === id)).filter(Boolean);

    if (titleEl) {
      titleEl.textContent = `Tareas Enlazadas (${linkedTasks.length})`;
    }

    if (linkSelect) {
      const eligible = allTasks.filter(t => t.id !== task.id && !linkedIds.includes(t.id));
      linkSelect.innerHTML = '<option value="">Seleccionar tarea para enlazar...</option>' +
        eligible.map(t => `<option value="${escapeHtml(t.id)}">#${formatTaskId(t.id)} - ${escapeHtml(t.name)} (${t.status})</option>`).join('');
    }

    if (linkedTasks.length === 0) {
      listEl.innerHTML = '<div class="ui message empty-message" style="background: rgba(255,255,255,0.05); color: #a0aec0; padding: 8px 12px; margin: 0;">No hay tareas enlazadas. Puedes enlazar una tarea existente arriba.</div>';
      return;
    }

    listEl.innerHTML = linkedTasks.map(linked => {
      const typeMeta = TASK_TYPES[canonicalTaskType(linked.type)] || TASK_TYPES['task'] || Object.values(TASK_TYPES)[0] || { label: linked.type, icon: 'tasks', color: 'grey' };
      const stId = canonicalState(linked.status);
      const stColor = STATES.find(s => s.id === stId)?.color || 'grey';
      const isDone = stId === 'done';
      return `
        <div class="item linked-task-list-item" style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
            <span class="ui mini ${typeMeta.color} label" title="Type: ${typeMeta.label}">
              <i class="${typeMeta.icon} icon"></i>${escapeHtml(typeMeta.label)}
            </span>
            <span class="ui mini ${stColor} label">${escapeHtml(linked.status)}</span>
            <a href="javascript:void(0)" class="linked-page-link" data-linked-id="${escapeHtml(linked.id)}" style="font-weight: 500; color: #fff; text-decoration: ${isDone ? 'line-through' : 'none'}; opacity: ${isDone ? 0.7 : 1}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              #${escapeHtml(formatTaskId(linked.id))} ${escapeHtml(linked.name)}
            </a>
          </div>
          <div>
            <button type="button" class="ui mini compact basic inverted icon button linked-unlink-btn" data-linked-id="${escapeHtml(linked.id)}" title="Desenlazar tarea">
              <i class="unlink icon"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.linked-page-link').forEach(a => {
      a.addEventListener('click', () => {
        const linkedId = a.getAttribute('data-linked-id');
        open(linkedId);
      });
    });

    listEl.querySelectorAll('.linked-unlink-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const linkedId = btn.getAttribute('data-linked-id');
        unlinkTasks(task.id, linkedId, allTasks);
        window.VG.App.persistChanges('Task unlinked');
        renderLinkedTasks(task);
        if (window.VG.Board) window.VG.Board.renderBoard();
      });
    });
  }

  function handleLinkTask() {
    const task = getCurrentTask();
    if (!task) return;
    const linkSelect = el('pageLinkTaskSelect');
    const selectedId = linkSelect ? linkSelect.value : '';
    if (!selectedId) return;

    const allTasks = window.VG.App.getTasks();
    const res = linkTasks(task.id, selectedId, allTasks);
    if (!res.success) {
      UI.toast(res.error || 'Failed to link task', 'error');
      return;
    }

    window.VG.App.persistChanges('Task linked');
    renderLinkedTasks(task);
    if (window.VG.Board) window.VG.Board.renderBoard();
  }

  function renderSubtasks(task) {
    const listEl = el('pageSubtasksList');
    const titleEl = el('pageSubtasksTitle');
    const linkSelect = el('pageLinkExistingSubtaskSelect');
    if (!listEl) return;

    const allTasks = window.VG.App.getTasks();
    const subtasks = allTasks.filter(t => t.parentId === task.id);

    if (titleEl) {
      titleEl.textContent = `Subtasks (${subtasks.length})`;
    }

    if (linkSelect) {
      const eligible = getEligibleSubtasks(task.id, allTasks);
      linkSelect.innerHTML = '<option value="">Seleccionar tarea para asignar como subtarea...</option>' +
        eligible.map(t => `<option value="${escapeHtml(t.id)}">#${formatTaskId(t.id)} - ${escapeHtml(t.name)} (${t.status})</option>`).join('');
    }

    if (subtasks.length === 0) {
      listEl.innerHTML = '<div class="ui message empty-message" style="background: rgba(255,255,255,0.05); color: #a0aec0;">No subtasks yet. You can add one quickly above or link an existing task.</div>';
      return;
    }

    listEl.innerHTML = subtasks.map(sub => {
      const typeMeta = TASK_TYPES[canonicalTaskType(sub.type)] || TASK_TYPES['task'] || Object.values(TASK_TYPES)[0] || { label: sub.type, icon: 'tasks', color: 'grey' };
      const stId = canonicalState(sub.status);
      const stColor = STATES.find(s => s.id === stId)?.color || 'grey';
      const isDone = stId === 'done';
      return `
        <div class="item subtask-list-item" style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
            <span class="ui mini ${typeMeta.color} label" title="Type: ${typeMeta.label}">
              <i class="${typeMeta.icon} icon"></i>${escapeHtml(typeMeta.label)}
            </span>
            <span class="ui mini ${stColor} label">${escapeHtml(sub.status)}</span>
            <a href="javascript:void(0)" class="subtask-page-link" data-subtask-id="${escapeHtml(sub.id)}" style="font-weight: 500; color: #fff; text-decoration: ${isDone ? 'line-through' : 'none'}; opacity: ${isDone ? 0.7 : 1}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              #${escapeHtml(formatTaskId(sub.id))} ${escapeHtml(sub.name)}
            </a>
          </div>
          <div>
            <button type="button" class="ui mini compact basic inverted icon button subtask-unlink-btn" data-subtask-id="${escapeHtml(sub.id)}" title="Unlink subtask">
              <i class="unlink icon"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.subtask-page-link').forEach(a => {
      a.addEventListener('click', () => {
        const subId = a.getAttribute('data-subtask-id');
        open(subId);
      });
    });

    listEl.querySelectorAll('.subtask-unlink-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const subId = btn.getAttribute('data-subtask-id');
        const target = allTasks.find(t => t.id === subId);
        if (target) {
          target.parentId = null;
          window.VG.App.persistChanges('Subtask unlinked');
          renderSubtasks(task);
          if (window.VG.Board) window.VG.Board.renderBoard();
        }
      });
    });
  }

  function handleQuickAddSubtask() {
    const task = getCurrentTask();
    if (!task) return;
    const titleInput = el('newPageSubtaskTitle');
    const typeSelect = el('newPageSubtaskType');
    const title = (titleInput ? titleInput.value : '').trim();
    if (!title) return;

    const allTasks = window.VG.App.getTasks();
    const subType = typeSelect ? canonicalTaskType(typeSelect.value) : 'task';
    const now = new Date().toISOString();
    const currentUser = window.VG.Auth && window.VG.Auth.getCurrentUser();
    const reporter = (currentUser && currentUser.username) ? currentUser.username : 'User';
    const subId = (window.VG.App && window.VG.App.getNextTaskId)
      ? window.VG.App.getNextTaskId()
      : window.VG.Constants.generateSequentialTaskId(allTasks, 'lud-');

    const newSub = {
      id: subId,
      project: window.VG.App.getActiveProjectId(),
      name: title,
      description: '',
      'openspec-id': '',
      type: subType,
      parentId: task.id,
      status: 'planned',
      priority: 'medium',
      favorite: false,
      assignee: null,
      reporter,
      tags: [],
      created_at: now,
      updated_at: now,
      history: [{
        from_status: null,
        to_status: 'planned',
        timestamp: now,
        reason: `Subtask of #${formatTaskId(task.id)}`,
        user: (currentUser && currentUser.username) ? currentUser.username : null
      }],
      comments: [],
      attachments: []
    };

    allTasks.unshift(newSub);
    if (titleInput) titleInput.value = '';
    window.VG.App.persistChanges('Subtask created');
    renderSubtasks(task);
    if (window.VG.Board) window.VG.Board.renderBoard();
  }

  function handleLinkExistingSubtask() {
    const task = getCurrentTask();
    if (!task) return;
    const linkSelect = el('pageLinkExistingSubtaskSelect');
    const selectedId = linkSelect ? linkSelect.value : '';
    if (!selectedId) return;

    const allTasks = window.VG.App.getTasks();
    const childTask = allTasks.find(t => t.id === selectedId);
    if (!childTask) return;

    const check = validateSubtaskRelationship(task.id, childTask.id, allTasks);
    if (!check.valid) {
      UI.toast(check.error, 'error');
      return;
    }

    childTask.parentId = task.id;
    window.VG.App.persistChanges('Subtask linked');
    renderSubtasks(task);
    if (window.VG.Board) window.VG.Board.renderBoard();
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
    if (el('pageTaskType')) {
      el('pageTaskType').innerHTML = Object.entries(TASK_TYPES)
        .map(([id, meta]) => `<option value="${escapeHtml(id)}">${escapeHtml(meta.label)}</option>`)
        .join('');
    }
    if (el('newPageSubtaskType')) {
      el('newPageSubtaskType').innerHTML = Object.entries(TASK_TYPES)
        .map(([id, meta]) => `<option value="${escapeHtml(id)}">${escapeHtml(meta.label)}</option>`)
        .join('');
    }
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

    tagPicker = window.VG.Tags.createPicker(el('pageTaskTags'), { onChange: updateDirtyState });

    ['pageTaskName', 'pageTaskOpenspecId'].forEach(id => {
      const element = el(id);
      if (element) element.addEventListener('input', updateDirtyState);
    });
    ['pageTaskType', 'pageTaskState', 'pageTaskPriority', 'pageTaskAssignee'].forEach(id => {
      const element = el(id);
      if (element) element.addEventListener('change', updateDirtyState);
    });

    const btnQuickAdd = el('btnPageQuickAddSubtask');
    if (btnQuickAdd) btnQuickAdd.addEventListener('click', handleQuickAddSubtask);
    const newSubTitle = el('newPageSubtaskTitle');
    if (newSubTitle) {
      newSubTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleQuickAddSubtask();
        }
      });
    }
    const btnLink = el('btnPageLinkExistingSubtask');
    if (btnLink) btnLink.addEventListener('click', handleLinkExistingSubtask);
    const btnLinkTask = el('btnPageLinkTask');
    if (btnLinkTask) btnLinkTask.addEventListener('click', handleLinkTask);

    const pageFavBtn = el('pageFavBtn');
    if (pageFavBtn) {
      pageFavBtn.addEventListener('click', () => {
        const cb = el('pageTaskFavorite');
        if (cb) {
          cb.checked = !cb.checked;
          updateDirtyState();
          updatePageFavBtn();
        }
      });
    }

    const pageTaskFavorite = el('pageTaskFavorite');
    if (pageTaskFavorite) {
      pageTaskFavorite.addEventListener('change', () => {
        updateDirtyState();
        updatePageFavBtn();
      });
    }

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

    commentEditor = Markdown.createEditor(el('pageCommentText'), {
      compact: true,
      minHeight: '85px',
      onSubmit: () => {
        const form = el('pageCommentForm');
        if (form) form.requestSubmit();
      }
    });
    if (window.VG.Mentions) window.VG.Mentions.attach(commentEditor);

    el('pageCommentText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        el('pageCommentForm').requestSubmit();
      }
    });

    // Ctrl/Cmd+S and Ctrl/Cmd+Enter save the task fields
    el('taskPage').addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const isCommentInput = e.target && (
        e.target.id === 'pageCommentText' ||
        (commentEditor && commentEditor.codemirror && commentEditor.codemirror.getWrapperElement().contains(e.target))
      );
      const isSave = e.key === 's' || e.key === 'S' || (e.key === 'Enter' && !isCommentInput);
      if (isSave) {
        e.preventDefault();
        save();
      }
    });

    // Clicking rendered images in markdown comments or description opens lightbox
    el('taskPage').addEventListener('click', (e) => {
      const img = e.target.closest('.editor-preview img, #pageCommentsList .comment img');
      if (!img || img.classList.contains('avatar') || img.closest('[data-preview]')) return;
      if (Attachments && Attachments.showSingleImage) {
        Attachments.showSingleImage({
          src: img.src,
          title: img.alt || 'Imagen',
          filename: img.alt || 'image'
        });
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
    onTasksReplaced,
    refreshTaskTypes: fillSelects
  };
})();
