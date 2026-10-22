/**
 * bitacore: Project Overview Controller
 * Second view of the board area (Board | Overview). Renders summary cards with
 * hand-built SVG/CSS charts: status, priority, type, assignee, tags, activity
 * over time and the tasks with the most recent activity.
 */
(function() {
  window.VG = window.VG || {};

  const Constants = window.VG.Constants || {};
  const escapeHtml = Constants.escapeHtml;
  const canonicalState = Constants.canonicalState;
  const canonicalPriority = Constants.canonicalPriority;
  const canonicalTaskType = Constants.canonicalTaskType;
  const formatRelativeTime = Constants.formatRelativeTime;
  const formatTaskId = Constants.formatTaskId || (id => id);
  const STATES = Constants.STATES || [];
  const PRIORITIES = Constants.PRIORITIES || {};

  const MODE_KEY = 'vg-board-view-mode';
  const ACTIVITY_DAYS = 14;
  const RECENT_LIMIT = 8;
  const MAX_ROWS = 8;

  // Fomantic-UI color names -> hex, tuned for the dark surface
  const COLOR_HEX = {
    red: '#e5484d',
    orange: '#f2711c',
    yellow: '#f5c518',
    olive: '#b5cc18',
    green: '#30a46c',
    teal: '#12a594',
    blue: '#3e8ae6',
    violet: '#8e6cef',
    purple: '#b45bd6',
    pink: '#e93d82',
    brown: '#a5673f',
    grey: '#7c8591',
    black: '#4a5059'
  };

  let mode = 'board';
  let initialized = false;

  function el(id) {
    return document.getElementById(id);
  }

  function hex(color) {
    return COLOR_HEX[color] || COLOR_HEX.grey;
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function pct(part, total) {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }

  function readStoredMode() {
    try {
      return localStorage.getItem(MODE_KEY) === 'overview' ? 'overview' : 'board';
    } catch (e) {
      return 'board';
    }
  }

  function storeMode(value) {
    try {
      localStorage.setItem(MODE_KEY, value);
    } catch (e) {
      // Storage unavailable: the choice just lasts for this page load
    }
  }

  function isOpen() {
    const overview = el('projectOverview');
    return !!overview && mode === 'overview' && overview.style.display !== 'none';
  }

  /**
   * The overview occupies the board's slot: it is only shown while the board
   * itself would be visible (connected, logged in, a project selected, not in
   * the admin panel). The board's inline display is the source of truth.
   */
  function boardAvailable() {
    const board = el('kanbanBoard');
    return !!board && board.style.display !== 'none';
  }

  function syncVisibility() {
    const overview = el('projectOverview');
    if (!overview) return;
    const show = mode === 'overview' && boardAvailable();
    const wasHidden = overview.style.display === 'none';
    overview.style.display = show ? 'grid' : 'none';
    document.body.classList.toggle('view-overview', mode === 'overview');

    document.querySelectorAll('.view-switch-btn').forEach(btn => {
      const active = btn.getAttribute('data-view') === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    if (show && wasHidden) render();
  }

  function setMode(value) {
    mode = value === 'overview' ? 'overview' : 'board';
    storeMode(mode);
    syncVisibility();
    if (mode === 'overview') {
      render();
    } else if (window.VG.Board && window.VG.Board.renderBoard) {
      window.VG.Board.renderBoard();
    }
  }

  function refresh() {
    if (isOpen()) render();
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  /** Every dated event of a task: creation, status changes, comments, files */
  function taskEvents(task) {
    const events = [];
    if (task.created_at) {
      events.push({ time: task.created_at, user: task.reporter || '', kind: 'created' });
    }
    (task.history || []).forEach(h => {
      events.push({ time: h.timestamp, user: h.user || '', kind: 'status', to: h.to_status });
    });
    (task.comments || []).forEach(c => {
      events.push({ time: c.timestamp, user: c.author || '', kind: 'comment', text: c.text });
    });
    (task.attachments || []).forEach(a => {
      events.push({ time: a.created_at, user: a.uploader || '', kind: 'attachment', name: a.name || a.filename });
    });
    return events
      .map(e => ({ ...e, ms: Date.parse(e.time) }))
      .filter(e => Number.isFinite(e.ms));
  }

  function computeStats(tasks) {
    const byStatus = {};
    STATES.forEach(s => { byStatus[s.id] = 0; });
    const byPriority = {};
    Object.keys(PRIORITIES).forEach(p => { byPriority[p] = { open: 0, done: 0 }; });
    const byType = {};
    const byUser = new Map();
    const byTag = new Map();

    const dayMs = 86400000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const firstDay = today.getTime() - (ACTIVITY_DAYS - 1) * dayMs;
    const activity = Array.from({ length: ACTIVITY_DAYS }, (_, i) => ({
      day: new Date(firstDay + i * dayMs),
      created: 0,
      done: 0,
      other: 0
    }));

    const recent = [];

    tasks.forEach(task => {
      const status = canonicalState(task.status);
      const isDone = status === 'done';
      byStatus[status] = (byStatus[status] || 0) + 1;

      const prio = canonicalPriority(task.priority);
      if (!byPriority[prio]) byPriority[prio] = { open: 0, done: 0 };
      byPriority[prio][isDone ? 'done' : 'open']++;

      const type = canonicalTaskType(task.type);
      if (!byType[type]) byType[type] = { open: 0, done: 0 };
      byType[type][isDone ? 'done' : 'open']++;

      const userKey = task.assignee || '';
      if (!byUser.has(userKey)) byUser.set(userKey, { total: 0, byStatus: {} });
      const userEntry = byUser.get(userKey);
      userEntry.total++;
      userEntry.byStatus[status] = (userEntry.byStatus[status] || 0) + 1;

      (task.tags || []).forEach(tag => {
        const key = String(tag).toLowerCase();
        if (!byTag.has(key)) byTag.set(key, { name: tag, open: 0, done: 0 });
        byTag.get(key)[isDone ? 'done' : 'open']++;
      });

      const events = taskEvents(task);
      events.forEach(e => {
        const index = Math.floor((e.ms - firstDay) / dayMs);
        if (index < 0 || index >= ACTIVITY_DAYS) return;
        if (e.kind === 'created') activity[index].created++;
        else if (e.kind === 'status' && e.to === 'done') activity[index].done++;
        else activity[index].other++;
      });

      if (events.length > 0) {
        const last = events.reduce((a, b) => (b.ms > a.ms ? b : a));
        recent.push({ task, event: last, count: events.length });
      }
    });

    recent.sort((a, b) => b.event.ms - a.event.ms);

    const total = tasks.length;
    const done = byStatus.done || 0;
    const unassigned = byUser.has('') ? byUser.get('').total : 0;
    const openBlockers = byPriority.blocker ? byPriority.blocker.open : 0;

    return {
      total,
      done,
      open: total - done,
      inProgress: byStatus['in progress'] || 0,
      inReview: byStatus['in review'] || 0,
      blocked: byStatus.blocked || 0,
      unassigned,
      openBlockers,
      byStatus,
      byPriority,
      byType,
      byUser,
      byTag,
      activity,
      recent: recent.slice(0, RECENT_LIMIT)
    };
  }

  // ---------------------------------------------------------------------------
  // Chart pieces
  // ---------------------------------------------------------------------------

  function card(title, icon, body, opts = {}) {
    return `
      <section class="overview-card ${opts.className || ''}">
        <header class="overview-card-head">
          <div class="overview-card-title"><i class="${icon} icon"></i>${escapeHtml(title)}</div>
          ${opts.aside ? `<div class="overview-card-aside">${opts.aside}</div>` : ''}
        </header>
        <div class="overview-card-body">${body}</div>
      </section>
    `;
  }

  function emptyNote(text) {
    return `<div class="overview-empty-note">${escapeHtml(text)}</div>`;
  }

  function kpi(label, value, sub, icon, color, filter) {
    const attrs = filter ? `role="button" tabindex="0" data-filter-kind="${filter.kind}" data-filter-value="${escapeHtml(filter.value)}"` : '';
    return `
      <div class="overview-kpi ${filter ? 'is-link' : ''}" ${attrs}>
        <div class="overview-kpi-label"><i class="${icon} icon" style="color: ${hex(color)};"></i>${escapeHtml(label)}</div>
        <div class="overview-kpi-value">${value}</div>
        <div class="overview-kpi-sub">${sub}</div>
      </div>
    `;
  }

  /** Donut of task counts per status, with a 2px surface gap between arcs */
  function statusDonut(stats) {
    const size = 168;
    const stroke = 22;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const gap = stats.total > 1 ? 2 : 0;
    let offset = 0;

    const arcs = STATES.map(s => {
      const n = stats.byStatus[s.id] || 0;
      if (n === 0) return '';
      const len = (n / stats.total) * c;
      const dash = Math.max(len - gap, 0.5);
      const arc = `
        <circle class="overview-donut-arc" cx="${size / 2}" cy="${size / 2}" r="${r}"
          fill="none" stroke="${hex(s.color)}" stroke-width="${stroke}"
          stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}"
          data-tip="${escapeHtml(`${s.label}: ${plural(n, 'task')} (${pct(n, stats.total)}%)`)}"
          data-filter-kind="status" data-filter-value="${escapeHtml(s.id)}" />
      `;
      offset += len;
      return arc;
    }).join('');

    const legend = STATES.map(s => {
      const n = stats.byStatus[s.id] || 0;
      return `
        <li class="overview-legend-row" data-tip="${escapeHtml(`${s.label}: ${plural(n, 'task')}`)}">
          <span class="overview-swatch" style="background: ${hex(s.color)};"></span>
          <span class="overview-legend-label"><i class="${s.icon} icon"></i>${escapeHtml(s.label)}</span>
          <span class="overview-legend-value">${n}</span>
          <span class="overview-legend-pct">${pct(n, stats.total)}%</span>
        </li>
      `;
    }).join('');

    return `
      <div class="overview-donut-wrap">
        <svg class="overview-donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Tasks by status">
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--app-surface-3)" stroke-width="${stroke}" />
          <g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g>
          <text x="50%" y="47%" text-anchor="middle" class="overview-donut-value">${pct(stats.done, stats.total)}%</text>
          <text x="50%" y="61%" text-anchor="middle" class="overview-donut-caption">completed</text>
        </svg>
        <ul class="overview-legend">${legend}</ul>
      </div>
      <div class="overview-progress" data-tip="${escapeHtml(`${stats.done} of ${plural(stats.total, 'task')} done`)}">
        <div class="overview-progress-track">
          <div class="overview-progress-fill" style="width: ${pct(stats.done, stats.total)}%;"></div>
        </div>
        <div class="overview-progress-label">${stats.done} / ${stats.total} done</div>
      </div>
    `;
  }

  /**
   * Horizontal bars: solid segment = open tasks, faded segment = done tasks,
   * both in the entity's own color. Rows link to the board with that filter.
   */
  function openDoneBars(rows, filterKind) {
    const visible = rows.filter(r => r.open + r.done > 0);
    if (visible.length === 0) return emptyNote('No tasks yet');
    const max = Math.max(...visible.map(r => r.open + r.done));

    const body = visible.map(row => {
      const total = row.open + row.done;
      const openW = (row.open / max) * 100;
      const doneW = (row.done / max) * 100;
      const tip = `${row.label}: ${row.open} open · ${row.done} done`;
      const link = filterKind && row.filterValue !== undefined;
      return `
        <div class="overview-bar-row ${link ? 'is-link' : ''}" data-tip="${escapeHtml(tip)}"
          ${link ? `role="button" tabindex="0" data-filter-kind="${filterKind}" data-filter-value="${escapeHtml(row.filterValue)}"` : ''}>
          <div class="overview-bar-label" title="${escapeHtml(row.label)}">
            ${row.icon ? `<i class="${escapeHtml(row.icon)} icon" style="color: ${hex(row.color)};"></i>` : ''}${escapeHtml(row.label)}
          </div>
          <div class="overview-bar-track">
            ${row.open > 0 ? `<span class="overview-bar-seg" style="width: ${openW}%; background: ${hex(row.color)};"></span>` : ''}
            ${row.done > 0 ? `<span class="overview-bar-seg is-done" style="width: ${doneW}%; background: ${hex(row.color)};"></span>` : ''}
          </div>
          <div class="overview-bar-value">${row.open}<span class="overview-bar-of">/${total}</span></div>
        </div>
      `;
    }).join('');

    return `
      <div class="overview-bars">${body}</div>
      <div class="overview-mini-legend">
        <span><span class="overview-swatch"></span>Open</span>
        <span><span class="overview-swatch is-done"></span>Done</span>
        <span class="overview-mini-legend-note">value = open / total</span>
      </div>
    `;
  }

  /** One bar per assignee, stacked by status */
  function assigneeBars(stats) {
    const entries = [...stats.byUser.entries()]
      .map(([user, data]) => ({ user, ...data }))
      .sort((a, b) => b.total - a.total || a.user.localeCompare(b.user));
    if (entries.length === 0) return emptyNote('No tasks yet');

    let shown = entries;
    if (entries.length > MAX_ROWS) {
      const rest = entries.slice(MAX_ROWS - 1);
      const other = { user: null, total: 0, byStatus: {}, count: rest.length };
      rest.forEach(e => {
        other.total += e.total;
        Object.entries(e.byStatus).forEach(([k, v]) => { other.byStatus[k] = (other.byStatus[k] || 0) + v; });
      });
      shown = entries.slice(0, MAX_ROWS - 1).concat(other);
    }
    const max = Math.max(...shown.map(e => e.total));

    const rows = shown.map(e => {
      const isOther = e.user === null;
      const label = isOther ? `Other (${e.count})` : (e.user || 'Unassigned');
      const segs = STATES.map(s => {
        const n = e.byStatus[s.id] || 0;
        if (n === 0) return '';
        return `<span class="overview-bar-seg" style="width: ${(n / max) * 100}%; background: ${hex(s.color)};"
          data-tip="${escapeHtml(`${label} · ${s.label}: ${n}`)}"></span>`;
      }).join('');
      const link = !isOther && e.user;
      const done = e.byStatus.done || 0;
      return `
        <div class="overview-bar-row ${link ? 'is-link' : ''}"
          ${link ? `role="button" tabindex="0" data-filter-kind="user" data-filter-value="${escapeHtml(e.user)}"` : ''}>
          <div class="overview-bar-label ${e.user ? '' : 'is-muted'}" title="${escapeHtml(label)}">
            <i class="${isOther ? 'users' : (e.user ? 'user' : 'user outline')} icon"></i>${escapeHtml(label)}
          </div>
          <div class="overview-bar-track">${segs}</div>
          <div class="overview-bar-value" data-tip="${escapeHtml(`${done} of ${e.total} done`)}">${e.total}<span class="overview-bar-of"> · ${pct(done, e.total)}%</span></div>
        </div>
      `;
    }).join('');

    const legend = STATES.map(s =>
      `<span><span class="overview-swatch" style="background: ${hex(s.color)};"></span>${escapeHtml(s.label)}</span>`
    ).join('');

    return `
      <div class="overview-bars">${rows}</div>
      <div class="overview-mini-legend">${legend}<span class="overview-mini-legend-note">value = total · % done</span></div>
    `;
  }

  /** Column chart of daily events over the last ACTIVITY_DAYS days */
  function activityChart(stats) {
    const days = stats.activity;
    const totals = days.map(d => d.created + d.done + d.other);
    const max = Math.max(1, ...totals);
    const sum = totals.reduce((a, b) => a + b, 0);

    const series = [
      { key: 'created', label: 'Created', color: hex('blue') },
      { key: 'done', label: 'Completed', color: hex('green') },
      { key: 'other', label: 'Other activity', color: hex('grey') }
    ];

    const cols = days.map((d, i) => {
      const label = d.day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      // Bottom-up stack; column-reverse puts the first series on the baseline
      const segs = series.filter(s => d[s.key] > 0).map(s =>
        `<span class="overview-col-seg" style="height: ${(d[s.key] / max) * 100}%; background: ${s.color};"></span>`
      ).join('');
      const tip = `${label}: ${d.created} created · ${d.done} completed · ${d.other} other`;
      const showTick = i === 0 || i === days.length - 1 || i % 7 === (days.length - 1) % 7;
      return `
        <div class="overview-col" data-tip="${escapeHtml(tip)}">
          <div class="overview-col-stack">${segs}</div>
          <div class="overview-col-tick">${showTick ? escapeHtml(d.day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) : ''}</div>
        </div>
      `;
    }).join('');

    const legend = series.map(s =>
      `<span><span class="overview-swatch" style="background: ${s.color};"></span>${s.label}</span>`
    ).join('');

    return `
      <div class="overview-activity" role="img" aria-label="Activity over the last ${ACTIVITY_DAYS} days">
        <div class="overview-activity-max">max ${max}/day</div>
        <div class="overview-activity-cols">${cols}</div>
      </div>
      <div class="overview-mini-legend">${legend}<span class="overview-mini-legend-note">${plural(sum, 'event')} in ${ACTIVITY_DAYS} days</span></div>
    `;
  }

  function describeEvent(event) {
    const who = event.user ? `<strong>${escapeHtml(event.user)}</strong> ` : '';
    switch (event.kind) {
      case 'created':
        return `${who}created the task`;
      case 'status': {
        const state = STATES.find(s => s.id === event.to) || { label: event.to, color: 'grey' };
        return `${who}moved it to <span class="overview-inline-state" style="color: ${hex(state.color)};">${escapeHtml(state.label)}</span>`;
      }
      case 'comment': {
        const text = String(event.text || '').replace(/\s+/g, ' ').trim();
        const short = text.length > 70 ? `${text.slice(0, 70)}…` : text;
        return `${who}commented${short ? `: <span class="overview-inline-quote">"${escapeHtml(short)}"</span>` : ''}`;
      }
      case 'attachment':
        return `${who}attached <span class="overview-inline-quote">${escapeHtml(event.name || 'a file')}</span>`;
      default:
        return 'Activity';
    }
  }

  function recentList(stats) {
    if (stats.recent.length === 0) return emptyNote('No activity yet');
    return `<ul class="overview-recent">${stats.recent.map(({ task, event }) => {
      const state = STATES.find(s => s.id === canonicalState(task.status)) || { label: task.status, color: 'grey', icon: 'circle' };
      const iconByKind = { created: 'plus circle', status: 'exchange', comment: 'comment alternate outline', attachment: 'paperclip' };
      return `
        <li class="overview-recent-item" role="button" tabindex="0" data-task-id="${escapeHtml(task.id)}" title="Open task">
          <i class="${iconByKind[event.kind] || 'circle'} icon overview-recent-icon"></i>
          <div class="overview-recent-main">
            <div class="overview-recent-title">
              <span class="overview-recent-id">${escapeHtml(formatTaskId(task.id))}</span>
              <span class="overview-recent-name">${escapeHtml(task.name || 'Untitled task')}</span>
            </div>
            <div class="overview-recent-desc">${describeEvent(event)}</div>
          </div>
          <div class="overview-recent-meta">
            <span class="ui mini ${escapeHtml(state.color || 'grey')} label">${escapeHtml(state.label)}</span>
            <span class="overview-recent-time" title="${escapeHtml(new Date(event.ms).toLocaleString())}">${escapeHtml(formatRelativeTime(event.time))}</span>
          </div>
        </li>
      `;
    }).join('')}</ul>`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function render() {
    const container = el('projectOverview');
    if (!container || !isOpen()) return;

    const tasks = window.VG.App ? window.VG.App.getTasks() : [];
    const stats = computeStats(tasks);
    const taskTypes = Constants.TASK_TYPES || {};

    if (stats.total === 0) {
      container.innerHTML = `
        <section class="overview-card overview-span-all">
          <div class="overview-empty-note is-large">
            <i class="chart pie icon"></i>
            <div>This project has no tasks yet. Create a task on the board to see its overview here.</div>
          </div>
        </section>
      `;
      return;
    }

    const priorityRows = Object.entries(PRIORITIES).map(([id, meta]) => ({
      label: meta.label,
      icon: meta.icon,
      color: meta.color,
      filterValue: id,
      ...(stats.byPriority[id] || { open: 0, done: 0 })
    }));

    const typeIds = Object.keys(taskTypes).concat(Object.keys(stats.byType).filter(id => !taskTypes[id]));
    const typeRows = typeIds.map(id => {
      const meta = taskTypes[id] || { label: id, icon: 'question circle outline', color: 'grey' };
      return {
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        filterValue: taskTypes[id] ? id : undefined,
        ...(stats.byType[id] || { open: 0, done: 0 })
      };
    }).sort((a, b) => (b.open + b.done) - (a.open + a.done));

    const tagColorOf = window.VG.Tags && window.VG.Tags.colorOf ? window.VG.Tags.colorOf : () => 'grey';
    const tagRows = [...stats.byTag.values()]
      .sort((a, b) => (b.open + b.done) - (a.open + a.done) || a.name.localeCompare(b.name))
      .slice(0, MAX_ROWS)
      .map(t => ({ label: t.name, icon: 'tag', color: tagColorOf(t.name), filterValue: t.name, open: t.open, done: t.done }));

    const completion = pct(stats.done, stats.total);

    container.innerHTML = `
      <div class="overview-kpis overview-span-all">
        ${kpi('Total tasks', stats.total, `${stats.open} open`, 'tasks', 'blue')}
        ${kpi('Completed', `${completion}%`, `${stats.done} done`, 'check circle', 'green', { kind: 'status', value: 'done' })}
        ${kpi('In progress', stats.inProgress, `${stats.inReview} in review`, 'bolt', 'orange', { kind: 'status', value: 'in progress' })}
        ${kpi('Blocked', stats.blocked, `${plural(stats.openBlockers, 'open blocker')}`, 'ban', 'red', { kind: 'status', value: 'blocked' })}
        ${kpi('Unassigned', stats.unassigned, `${pct(stats.unassigned, stats.total)}% of tasks`, 'user outline', 'grey')}
      </div>
      ${card('Recent activity', 'history', recentList(stats), { className: 'overview-span-all overview-card-recent' })}
      ${card('Status', 'chart pie', statusDonut(stats), { className: 'overview-card-status' })}
      ${card('Priority', 'flag', openDoneBars(priorityRows, 'priority'))}
      ${card('Type', 'shapes', openDoneBars(typeRows, 'type'))}
      ${card('Assignees', 'users', assigneeBars(stats), { className: 'overview-span-2' })}
      ${card('Tags', 'tags', tagRows.length ? openDoneBars(tagRows, 'tag') : emptyNote('No tags in this project'),
        { aside: stats.byTag.size > MAX_ROWS ? `top ${MAX_ROWS} of ${stats.byTag.size}` : '' })}
      ${card('Activity', 'chart bar', activityChart(stats), { className: 'overview-span-all', aside: `last ${ACTIVITY_DAYS} days` })}
    `;
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  /** Switches to the board with the filter that matches the clicked mark */
  function applyBoardFilter(kind, value) {
    if (kind === 'status') {
      // The board has no status filter: every status is its own column
      setMode('board');
      const column = document.querySelector(`[data-col-state="${CSS.escape(value)}"]`);
      if (column && column.scrollIntoView) column.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      return;
    }
    const selectId = { priority: 'priorityFilter', type: 'typeFilter', tag: 'tagFilter', user: 'userFilter' }[kind];
    const select = selectId && el(selectId);
    if (!select) return;
    const option = [...select.options].find(o => o.value.toLowerCase() === String(value).toLowerCase());
    if (!option) return;
    select.value = option.value;
    if (kind === 'user') {
      // An assignee bar counts assigned tasks only, so match that on the board
      const criteria = { chkCriteriaAssignee: true, chkCriteriaCreator: false, chkCriteriaCommenter: false, chkCriteriaUploader: false };
      Object.entries(criteria).forEach(([id, checked]) => {
        const box = el(id);
        if (box) box.checked = checked;
      });
    }
    setMode('board');
  }

  function initTooltip(container) {
    const tip = document.createElement('div');
    tip.className = 'overview-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.style.display = 'none';
    document.body.appendChild(tip);

    container.addEventListener('mousemove', e => {
      const target = e.target.closest('[data-tip]');
      if (!target || !container.contains(target)) {
        tip.style.display = 'none';
        return;
      }
      tip.textContent = target.getAttribute('data-tip');
      tip.style.display = 'block';
      const gap = 12;
      const rect = tip.getBoundingClientRect();
      let left = e.clientX + gap;
      let top = e.clientY + gap;
      if (left + rect.width > window.innerWidth - 8) left = e.clientX - rect.width - gap;
      if (top + rect.height > window.innerHeight - 8) top = e.clientY - rect.height - gap;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${Math.max(8, top)}px`;
    });
    container.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    container.addEventListener('scroll', () => { tip.style.display = 'none'; }, true);
  }

  function activate(target) {
    const taskItem = target.closest('[data-task-id]');
    if (taskItem) {
      const id = taskItem.getAttribute('data-task-id');
      if (id && window.VG.TaskPage) window.VG.TaskPage.open(id);
      return true;
    }
    const filterEl = target.closest('[data-filter-kind]');
    if (filterEl) {
      applyBoardFilter(filterEl.getAttribute('data-filter-kind'), filterEl.getAttribute('data-filter-value'));
      return true;
    }
    return false;
  }

  function init() {
    if (initialized) return;
    initialized = true;

    mode = readStoredMode();

    document.querySelectorAll('.view-switch-btn').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.getAttribute('data-view')));
    });

    const container = el('projectOverview');
    if (container) {
      container.addEventListener('click', e => { activate(e.target); });
      container.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) {
          e.preventDefault();
          activate(e.target);
        }
      });
      initTooltip(container);
    }

    // Follow the board's availability (empty states, admin panel, login...)
    const board = el('kanbanBoard');
    if (board && window.MutationObserver) {
      new MutationObserver(syncVisibility).observe(board, { attributes: true, attributeFilter: ['style'] });
    }

    syncVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.VG.Overview = {
    isOpen,
    setMode,
    getMode: () => mode,
    refresh,
    computeStats
  };
})();
