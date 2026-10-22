/**
 * vg-task-manager: Notifications
 *
 * Per-user notifications stored in the shared `notifications` collection
 * through vg-mongo-proxy. Document shape:
 *   { _id, recipient, recipientLower, type, project, projectName, taskId,
 *     taskName, actor, data, createdAt, read, readAt }
 *
 * Notifications are generated on the client: every save (App.persistChanges)
 * diffs the board against a snapshot of the last loaded/saved state. Each
 * notification type is a registered detector + renderer, so new types only
 * need a `registerType` call. The actor of a change is never notified.
 */
(function() {
  window.VG = window.VG || {};

  const COLLECTION = 'notifications';
  const LIST_LIMIT = 50;
  const POLL_INTERVAL_MS = 60 * 1000;

  const escapeHtml = (s) => window.VG.Constants.escapeHtml(s);

  /* -------------------------------------------------------------
   * TYPE REGISTRY
   * ------------------------------------------------------------- */

  /**
   * @typedef {Object} NotificationType
   * @property {string} icon Fomantic icon name
   * @property {string} color Fomantic color name
   * @property {(n: any) => string} describe HTML summary (values must be escaped)
   * @property {(change: TaskChange) => Array<{recipient: string, data?: any}>} [detect]
   *   recipients (and type-specific data) for one changed task
   */

  /**
   * @typedef {Object} TaskChange
   * @property {any} task current task
   * @property {any|null} before snapshot of the task at the last load/save (null for new tasks)
   * @property {string} actor username making the change
   */

  const TYPES = {};

  function registerType(id, def) {
    TYPES[id] = def;
  }

  const sameUser = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const actorHtml = (n) => `<strong>${escapeHtml(n.actor || 'Someone')}</strong>`;

  /** Fields watched by "task_changed", with how to display their values */
  const TRACKED_FIELDS = [
    { key: 'status', label: 'status', format: v => (window.VG.Constants.STATES.find(s => s.id === v) || {}).label || v },
    { key: 'priority', label: 'priority', format: v => (window.VG.Constants.PRIORITIES[v] || {}).label || v },
    { key: 'type', label: 'type', format: v => (window.VG.Constants.TASK_TYPES[v] || {}).label || v },
    { key: 'name', label: 'title' },
    { key: 'description', label: 'description', hideValue: true },
    { key: 'tags', label: 'tags', format: v => (Array.isArray(v) && v.length ? v.join(', ') : 'none') },
    { key: 'parentId', label: 'parent task', format: v => v || 'none' }
  ];

  registerType('mention', {
    icon: 'at',
    color: 'teal',
    describe: n => `${actorHtml(n)} mentioned you in a comment`,
    detect({ task, before, actor }) {
      const seen = new Set(before ? before.commentIds : []);
      const recipients = [];
      (task.comments || []).forEach(c => {
        if (seen.has(c.id) || !Array.isArray(c.mentions)) return;
        c.mentions.forEach(username => {
          if (sameUser(username, actor) || recipients.some(r => sameUser(r.recipient, username))) return;
          recipients.push({ recipient: username, data: { commentId: c.id, excerpt: excerpt(c.text) } });
        });
      });
      return recipients;
    }
  });

  registerType('assigned', {
    icon: 'user plus',
    color: 'blue',
    describe: n => `${actorHtml(n)} assigned you a task`,
    detect({ task, before, actor }) {
      const prev = before ? before.assignee : null;
      if (!task.assignee || sameUser(task.assignee, prev) || sameUser(task.assignee, actor)) return [];
      return [{ recipient: task.assignee }];
    }
  });

  registerType('task_changed', {
    icon: 'edit',
    color: 'orange',
    describe: n => {
      const changes = (n.data && Array.isArray(n.data.changes)) ? n.data.changes : [];
      const parts = changes.map(ch => {
        const label = escapeHtml(ch.label || ch.field);
        if (ch.to === undefined) return label;
        return `${label} → <strong>${escapeHtml(ch.to)}</strong>`;
      });
      return `${actorHtml(n)} changed ${parts.length ? parts.join(', ') : 'a task'} on a task assigned to you`;
    },
    detect({ task, before, actor }) {
      // New tasks and reassignments are covered by "assigned"
      if (!before || !task.assignee || sameUser(task.assignee, actor) || !sameUser(task.assignee, before.assignee)) return [];
      const changes = TRACKED_FIELDS
        .filter(f => JSON.stringify(task[f.key] ?? null) !== JSON.stringify(before.fields[f.key] ?? null))
        .map(f => {
          const change = { field: f.key, label: f.label };
          if (!f.hideValue) {
            const fmt = f.format || (v => (v === null || v === undefined || v === '' ? 'none' : String(v)));
            change.from = fmt(before.fields[f.key]);
            change.to = fmt(task[f.key]);
          }
          return change;
        });
      return changes.length ? [{ recipient: task.assignee, data: { changes } }] : [];
    }
  });

  function excerpt(md) {
    const text = window.VG.Markdown ? window.VG.Markdown.toPlainText(md) : String(md || '');
    return text.length > 140 ? text.slice(0, 137) + '…' : text;
  }

  /* -------------------------------------------------------------
   * CHANGE DETECTION
   * ------------------------------------------------------------- */

  let snapshot = new Map();

  function snapshotTask(t) {
    const fields = {};
    TRACKED_FIELDS.forEach(f => {
      const v = t[f.key];
      fields[f.key] = Array.isArray(v) ? v.slice() : (v === undefined ? null : v);
    });
    return {
      assignee: t.assignee || null,
      commentIds: (t.comments || []).map(c => c.id),
      fields
    };
  }

  /** Records the board as loaded, so only later edits produce notifications */
  function resetSnapshot(tasks) {
    snapshot = new Map((tasks || []).map(t => [t.id, snapshotTask(t)]));
  }

  /**
   * Diffs the board against the snapshot, advances the snapshot and returns the
   * notification documents to send once the board is saved.
   * @param {any[]} tasks
   * @returns {any[]}
   */
  function collectChanges(tasks) {
    const user = window.VG.Auth && window.VG.Auth.getCurrentUser();
    const actor = user && user.username;
    const docs = [];
    if (!actor) {
      resetSnapshot(tasks);
      return docs;
    }

    const project = window.VG.App && window.VG.App.getActiveProject();
    const projectId = window.VG.App && window.VG.App.getActiveProjectId();
    const now = new Date().toISOString();

    (tasks || []).forEach(task => {
      const change = { task, before: snapshot.get(task.id) || null, actor };
      Object.keys(TYPES).forEach(type => {
        const detect = TYPES[type].detect;
        if (!detect) return;
        detect(change).forEach(({ recipient, data }) => {
          if (!recipient || sameUser(recipient, actor)) return;
          docs.push({
            _id: window.VG.Constants.generateId('ntf'),
            recipient,
            recipientLower: recipient.toLowerCase(),
            type,
            project: projectId,
            projectName: (project && project.name) || projectId,
            taskId: task.id,
            taskName: task.name || task.id,
            actor,
            data: data || {},
            createdAt: now,
            read: false
          });
        });
      });
    });

    resetSnapshot(tasks);
    return docs;
  }

  /** Persists notification documents (from collectChanges) */
  async function send(docs) {
    if (!docs || docs.length === 0 || !isReady()) return;
    try {
      if (docs.length === 1) {
        await window.VG.MongoSync.action('insertOne', COLLECTION, { document: docs[0] });
      } else {
        await window.VG.MongoSync.action('insertMany', COLLECTION, { documents: docs });
      }
    } catch (err) {
      console.warn('[Notifications] Could not save notifications:', err.message);
    }
  }

  /* -------------------------------------------------------------
   * STORE
   * ------------------------------------------------------------- */

  let items = [];
  let unreadCount = 0;
  let pollTimer = null;
  let loadedFor = null;

  function isReady() {
    return Boolean(window.VG.MongoSync && window.VG.MongoSync.isConnected() &&
      window.VG.Auth && window.VG.Auth.getCurrentUser());
  }

  function currentUserKey() {
    const user = window.VG.Auth && window.VG.Auth.getCurrentUser();
    return user && user.username ? user.username.toLowerCase() : null;
  }

  async function refresh() {
    const me = currentUserKey();
    if (!isReady() || !me) {
      items = [];
      unreadCount = 0;
      render();
      return;
    }
    try {
      const [listRes, countRes] = await Promise.all([
        window.VG.MongoSync.action('find', COLLECTION, {
          filter: { recipientLower: me },
          sort: { createdAt: -1 },
          limit: LIST_LIMIT
        }),
        window.VG.MongoSync.action('count', COLLECTION, {
          filter: { recipientLower: me, read: false }
        })
      ]);
      if (currentUserKey() !== me) return; // user switched while loading
      items = (listRes && Array.isArray(listRes.documents)) ? listRes.documents : [];
      unreadCount = countRes && Number.isFinite(countRes.count) ? countRes.count : items.filter(n => !n.read).length;
    } catch (err) {
      console.warn('[Notifications] Could not load notifications:', err.message);
    }
    render();
  }

  async function markRead(id) {
    const n = items.find(x => x._id === id);
    if (!n || n.read) return;
    n.read = true;
    unreadCount = Math.max(0, unreadCount - 1);
    render();
    try {
      await window.VG.MongoSync.action('updateOne', COLLECTION, {
        filter: { _id: id, recipientLower: currentUserKey() },
        update: { $set: { read: true, readAt: new Date().toISOString() } }
      });
    } catch (err) {
      console.warn('[Notifications] Could not mark notification as read:', err.message);
    }
  }

  async function markAllRead() {
    const me = currentUserKey();
    if (!me) return;
    items.forEach(n => { n.read = true; });
    unreadCount = 0;
    render();
    try {
      await window.VG.MongoSync.action('updateMany', COLLECTION, {
        filter: { recipientLower: me, read: false },
        update: { $set: { read: true, readAt: new Date().toISOString() } }
      });
    } catch (err) {
      console.warn('[Notifications] Could not mark notifications as read:', err.message);
      refresh();
    }
  }

  /** Opens the notification's task, switching project first when needed */
  async function openNotification(id) {
    const n = items.find(x => x._id === id);
    if (!n) return;
    togglePopover(false);
    markRead(id);

    const App = window.VG.App;
    if (n.project && App.getActiveProjectId() !== n.project) {
      const selector = document.getElementById('projectSelector');
      if (selector && !Array.from(selector.options).some(o => o.value === n.project)) {
        App.showToast('You no longer have access to that project', 'warning');
        return;
      }
      if (selector) selector.value = n.project;
      await App.onProjectChanged(n.project);
    }
    if (!App.getTasks().some(t => t.id === n.taskId)) {
      App.showToast('That task no longer exists', 'warning');
      return;
    }
    window.VG.TaskPage.open(n.taskId);
  }

  /* -------------------------------------------------------------
   * UI
   * ------------------------------------------------------------- */

  function el(id) {
    return document.getElementById(id);
  }

  function renderItem(n) {
    const type = TYPES[n.type] || { icon: 'bell', color: 'grey', describe: x => `${actorHtml(x)} updated a task` };
    const projectId = window.VG.App && window.VG.App.getActiveProjectId();
    const otherProject = n.project && n.project !== projectId;
    const excerptText = n.data && n.data.excerpt;
    const time = window.VG.Constants.formatRelativeTime(n.createdAt);
    return `
      <button type="button" class="notification-item${n.read ? '' : ' unread'}" data-id="${escapeHtml(n._id)}">
        <i class="${escapeHtml(type.color)} ${escapeHtml(type.icon)} icon notification-icon"></i>
        <span class="notification-body">
          <span class="notification-text">${type.describe(n)}</span>
          <span class="notification-task">
            <span class="notification-task-id">${escapeHtml(n.taskId)}</span>
            ${escapeHtml(n.taskName || '')}
          </span>
          ${excerptText ? `<span class="notification-excerpt">“${escapeHtml(excerptText)}”</span>` : ''}
          <span class="notification-meta">
            <span title="${escapeHtml(new Date(n.createdAt).toLocaleString())}">${escapeHtml(time)}</span>
            ${otherProject ? `<span class="notification-project"><i class="folder outline icon"></i>${escapeHtml(n.projectName || n.project)}</span>` : ''}
          </span>
        </span>
        ${n.read ? '' : '<span class="notification-dot" aria-label="Unread"></span>'}
      </button>
    `;
  }

  function render() {
    const headerItem = el('notificationsHeaderItem');
    if (!headerItem) return;
    const ready = isReady();
    headerItem.style.display = ready ? '' : 'none';
    if (!ready) togglePopover(false);

    const badge = el('notificationsBadge');
    const btn = el('btnNotifications');
    if (badge) {
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.style.display = unreadCount > 0 ? '' : 'none';
    }
    if (btn) {
      btn.title = unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications';
      btn.classList.toggle('has-unread', unreadCount > 0);
      const icon = btn.querySelector('.icon');
      if (icon) icon.className = `${unreadCount > 0 ? 'bell' : 'bell outline'} icon`;
    }

    const markAll = el('btnMarkAllNotificationsRead');
    if (markAll) markAll.disabled = unreadCount === 0;

    const list = el('notificationsList');
    if (list) {
      list.innerHTML = items.length
        ? items.map(renderItem).join('')
        : '<div class="notifications-empty"><i class="bell slash outline icon"></i>No notifications yet</div>';
    }
  }

  function positionPopover() {
    const popover = el('notificationsPopover');
    const anchor = el('btnNotifications');
    if (!popover || !anchor || popover.style.display === 'none') return;
    // Fixed positioning escapes the horizontally scrolling header menu
    const gap = 8;
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    const left = Math.min(Math.max(gap, rect.right - width), window.innerWidth - width - gap);
    popover.style.top = `${Math.round(rect.bottom + gap)}px`;
    popover.style.left = `${Math.round(left)}px`;
  }

  function isPopoverOpen() {
    const popover = el('notificationsPopover');
    return Boolean(popover && popover.style.display !== 'none');
  }

  function togglePopover(force) {
    const popover = el('notificationsPopover');
    const btn = el('btnNotifications');
    if (!popover) return;
    const show = force !== undefined ? force : !isPopoverOpen();
    popover.style.display = show ? 'flex' : 'none';
    if (btn) {
      btn.setAttribute('aria-expanded', String(show));
      btn.classList.toggle('active', show);
    }
    if (show) {
      positionPopover();
      refresh();
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  /** Reloads when the logged-in user or the connection changes */
  function onSessionChange() {
    const key = isReady() ? currentUserKey() : null;
    if (key === loadedFor) return;
    loadedFor = key;
    items = [];
    unreadCount = 0;
    if (key) {
      refresh();
      startPolling();
    } else {
      stopPolling();
      render();
    }
  }

  function init() {
    const btn = el('btnNotifications');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        togglePopover();
      });
    }

    const markAll = el('btnMarkAllNotificationsRead');
    if (markAll) markAll.addEventListener('click', () => markAllRead());

    const list = el('notificationsList');
    if (list) {
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.notification-item');
        if (item) openNotification(item.dataset.id);
      });
    }

    document.addEventListener('click', (e) => {
      if (!isPopoverOpen()) return;
      const container = el('notificationsHeaderItem');
      const popover = el('notificationsPopover');
      if ((container && container.contains(e.target)) || (popover && popover.contains(e.target))) return;
      togglePopover(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isPopoverOpen()) togglePopover(false);
    });
    window.addEventListener('resize', positionPopover);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && loadedFor) refresh();
    });

    if (window.VG.Auth) window.VG.Auth.onAuthChange(onSessionChange);
    if (window.VG.MongoSync) window.VG.MongoSync.onConnectionChange(onSessionChange);
    onSessionChange();
  }

  window.VG.Notifications = {
    init,
    registerType,
    resetSnapshot,
    collectChanges,
    send,
    refresh,
    markRead,
    markAllRead
  };

  document.addEventListener('DOMContentLoaded', init);
})();
