/**
 * vg-task-manager: @mentions in comments
 *
 * - `@` autocomplete for comment editors (EasyMDE/CodeMirror) listing the
 *   active project's users
 * - extraction of the mentioned usernames, stored on the comment as `mentions`
 * - highlighting of mentions in rendered comment HTML
 */
(function() {
  window.VG = window.VG || {};

  const MAX_SUGGESTIONS = 8;

  function escapeHtml(str) {
    return window.VG.Constants.escapeHtml(str);
  }

  /** Users that belong to the active project (admins can access every project) */
  function getProjectUsers() {
    const users = (window.VG.Auth && window.VG.Auth.getCachedUsers()) || [];
    const projectId = window.VG.App && window.VG.App.getActiveProjectId();
    return users
      .filter(u => u && u.username && (!projectId || u.isAdmin || (Array.isArray(u.projects) && u.projects.includes(projectId))))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  function isMentionBoundary(ch) {
    return !ch || !/[\w@.-]/.test(ch);
  }

  /**
   * Usernames mentioned as `@username` in text, as canonical usernames from
   * `candidates`. Longest names match first so "@ana.maria" never counts as "@ana".
   * @param {string} text
   * @param {string[]} [candidates] known usernames (defaults to the project's users)
   * @returns {string[]}
   */
  function extract(text, candidates) {
    const source = String(text || '');
    const lower = source.toLowerCase();
    const names = (candidates || getProjectUsers().map(u => u.username))
      .filter(Boolean)
      .slice()
      .sort((a, b) => b.length - a.length);
    const found = [];
    const taken = [];

    names.forEach(name => {
      const needle = '@' + name.toLowerCase();
      let from = 0;
      let idx;
      while ((idx = lower.indexOf(needle, from)) !== -1) {
        from = idx + needle.length;
        const end = idx + needle.length;
        if (!isMentionBoundary(source[idx - 1]) || !isMentionBoundary(source[end])) continue;
        if (taken.some(([s, e]) => idx < e && end > s)) continue;
        taken.push([idx, end]);
        if (!found.includes(name)) found.push(name);
      }
    });
    return found;
  }

  /**
   * Wraps the `@username` occurrences of `mentions` in rendered (sanitized) HTML
   * with a highlight span. Text inside code blocks and links is left untouched.
   * @param {string} html
   * @param {string[]} mentions
   * @returns {string}
   */
  function highlight(html, mentions) {
    const names = window.VG.Validation.normalizeMentions(mentions).sort((a, b) => b.length - a.length);
    if (!html || names.length === 0 || typeof document === 'undefined') return html;

    const currentUser = window.VG.Auth && window.VG.Auth.getCurrentUser();
    const self = currentUser && currentUser.username ? currentUser.username.toLowerCase() : '';
    const pattern = new RegExp(`@(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w@.-])`, 'gi');

    const container = document.createElement('div');
    container.innerHTML = html;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement && node.parentElement.closest('code, pre, a, .mention')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
      const text = node.nodeValue;
      pattern.lastIndex = 0;
      if (!pattern.test(text)) return;
      pattern.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (!isMentionBoundary(text[match.index - 1])) continue;
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        const span = document.createElement('span');
        span.className = 'mention' + (match[1].toLowerCase() === self ? ' mention-self' : '');
        span.textContent = match[0];
        frag.appendChild(span);
        last = match.index + match[0].length;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return container.innerHTML;
  }

  /* -------------------------------------------------------------
   * AUTOCOMPLETE
   * ------------------------------------------------------------- */

  let menuEl = null;
  let active = null; // { cm, from, to, items, index, keyMap }

  function getMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'mention-menu';
    menuEl.setAttribute('role', 'listbox');
    menuEl.style.display = 'none';
    // mousedown (not click) so the editor keeps focus
    menuEl.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.mention-menu-item');
      if (!item) return;
      e.preventDefault();
      if (active) {
        active.index = Number(item.dataset.index);
        accept();
      }
    });
    document.body.appendChild(menuEl);
    return menuEl;
  }

  /** The `@query` being typed right before the cursor, if any */
  function queryAtCursor(cm) {
    const cursor = cm.getCursor();
    const before = cm.getLine(cursor.line).slice(0, cursor.ch);
    const match = before.match(/(^|[^\w@.-])@([^\s@]{0,40})$/);
    if (!match) return null;
    return {
      query: match[2],
      from: { line: cursor.line, ch: cursor.ch - match[2].length - 1 },
      to: cursor
    };
  }

  function rank(users, query) {
    const q = query.toLowerCase();
    return users
      .filter(u => u.username.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.username.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.username.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || a.username.localeCompare(b.username);
      })
      .slice(0, MAX_SUGGESTIONS);
  }

  function renderMenu() {
    const menu = getMenu();
    if (!active || active.items.length === 0) {
      close();
      return;
    }
    menu.innerHTML = active.items.map((u, i) => `
      <div class="mention-menu-item${i === active.index ? ' active' : ''}" role="option" data-index="${i}" aria-selected="${i === active.index}">
        <i class="user circle icon"></i>
        <span class="mention-menu-name">${escapeHtml(u.username)}</span>
        ${u.isAdmin ? '<span class="mention-menu-hint">admin</span>' : ''}
      </div>
    `).join('');

    const coords = active.cm.cursorCoords(active.from, 'window');
    menu.style.display = 'block';
    const gap = 4;
    const menuHeight = menu.offsetHeight;
    const menuWidth = menu.offsetWidth;
    let top = coords.bottom + gap;
    if (top + menuHeight > window.innerHeight - 8) top = coords.top - menuHeight - gap;
    const left = Math.min(Math.max(8, coords.left), window.innerWidth - menuWidth - 8);
    menu.style.top = `${Math.round(Math.max(8, top))}px`;
    menu.style.left = `${Math.round(left)}px`;
  }

  function move(delta) {
    if (!active) return;
    const n = active.items.length;
    active.index = (active.index + delta + n) % n;
    renderMenu();
  }

  function accept() {
    if (!active) return;
    const user = active.items[active.index];
    const { cm, from, to } = active;
    close();
    if (!user) return;
    cm.replaceRange(`@${user.username} `, from, to);
    cm.focus();
  }

  function close() {
    if (active && active.keyMap) active.cm.removeKeyMap(active.keyMap);
    active = null;
    if (menuEl) menuEl.style.display = 'none';
  }

  function update(cm) {
    const q = queryAtCursor(cm);
    if (!q || cm.somethingSelected()) {
      if (active && active.cm === cm) close();
      return;
    }
    const items = rank(getProjectUsers(), q.query);
    if (items.length === 0) {
      if (active && active.cm === cm) close();
      return;
    }
    if (!active || active.cm !== cm) {
      if (active) close();
      const keyMap = {
        Up: () => move(-1),
        Down: () => move(1),
        Enter: () => accept(),
        Tab: () => accept(),
        Esc: () => close()
      };
      cm.addKeyMap(keyMap);
      active = { cm, keyMap, index: 0 };
    }
    active.from = q.from;
    active.to = q.to;
    const previous = active.items && active.items[active.index];
    active.items = items;
    const keep = previous ? items.findIndex(u => u.username === previous.username) : -1;
    active.index = keep >= 0 ? keep : 0;
    renderMenu();
  }

  /**
   * Adds `@` autocomplete to a markdown editor created by VG.Markdown.createEditor.
   * @param {any} editor EasyMDE instance (null for plain textareas: no-op)
   */
  function attach(editor) {
    const cm = editor && editor.codemirror;
    if (!cm) return;
    cm.on('inputRead', () => update(cm));
    cm.on('cursorActivity', () => {
      if (active && active.cm === cm) update(cm);
    });
    cm.on('blur', () => {
      if (active && active.cm === cm) close();
    });
    cm.on('scroll', () => {
      if (active && active.cm === cm) renderMenu();
    });
  }

  window.addEventListener('resize', close);

  window.VG.Mentions = {
    attach,
    extract,
    highlight,
    getProjectUsers
  };
})();
