/**
 * bitacore: Tags (registry + picker)
 *
 * The registry lists every tag known to the board, saved in tasks.json as
 * `"tags": [{ "name": "frontend", "color": "blue" }, ...]`. Tasks reference
 * tags by name (`"tags": ["frontend"]`). Names are matched case-insensitively
 * and a tag typed in a picker that does not exist yet is created on save.
 */
(function() {
  window.VG = window.VG || {};
  const { escapeHtml } = window.VG.Constants;

  // Fomantic-UI colors, assigned in turn to new tags
  const COLORS = ['blue', 'teal', 'violet', 'orange', 'pink', 'green', 'yellow', 'purple', 'olive', 'red', 'brown', 'grey'];
  const MAX_NAME_LENGTH = 40;

  let registry = []; // [{ name, color }]

  /** Clean tag name, or '' when it is not usable. Commas separate tags in pickers. */
  function normalizeName(raw) {
    if (raw === null || raw === undefined) return '';
    return String(raw)
      .replace(/[,\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH);
  }

  function key(name) {
    return normalizeName(name).toLowerCase();
  }

  function find(name) {
    const k = key(name);
    return registry.find(t => t.name.toLowerCase() === k) || null;
  }

  function getAll() {
    return registry.map(t => ({ ...t }));
  }

  function colorOf(name) {
    const tag = find(name);
    return tag ? tag.color : 'grey';
  }

  function nextColor() {
    return COLORS[registry.length % COLORS.length];
  }

  /**
   * Makes sure every name is in the registry (creating missing tags) and
   * returns the names with the registry's casing, without duplicates.
   */
  function ensure(names) {
    const result = [];
    const seen = new Set();
    (names || []).forEach(raw => {
      const name = normalizeName(raw);
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      let tag = find(name);
      if (!tag) {
        tag = { name, color: nextColor() };
        registry.push(tag);
      }
      result.push(tag.name);
    });
    return result;
  }

  /** Normalizes a task's tag list (array or comma-separated string) */
  function normalizeList(raw) {
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
    const result = [];
    const seen = new Set();
    list.forEach(item => {
      const name = normalizeName(item);
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        result.push(name);
      }
    });
    return result;
  }

  /**
   * Replaces the registry from a tasks.json document: its "tags" entries plus
   * any tag used by a task. Task tag names are aligned to the registry casing.
   */
  function load(rawTags, tasks) {
    registry = [];
    (Array.isArray(rawTags) ? rawTags : []).forEach(entry => {
      const name = normalizeName(typeof entry === 'string' ? entry : entry && entry.name);
      if (!name || find(name)) return;
      const color = entry && typeof entry === 'object' && COLORS.includes(entry.color) ? entry.color : nextColor();
      registry.push({ name, color });
    });
    (tasks || []).forEach(task => {
      task.tags = ensure(task.tags);
    });
  }

  function clear() {
    registry = [];
  }

  /** Tag names with the number of tasks using each, in registry order */
  function usage(tasks) {
    const counts = new Map(registry.map(t => [t.name.toLowerCase(), 0]));
    (tasks || []).forEach(task => (task.tags || []).forEach(name => {
      const k = name.toLowerCase();
      if (counts.has(k)) counts.set(k, counts.get(k) + 1);
    }));
    return registry.map(t => ({ ...t, count: counts.get(t.name.toLowerCase()) || 0 }));
  }

  /** Small colored labels for a list of tag names */
  function renderLabels(names, { size = 'mini', highlight = null } = {}) {
    return (names || []).map(name => {
      const text = highlight ? highlight(name) : escapeHtml(name);
      return `<span class="ui ${size} ${colorOf(name)} label tag-label" data-tag="${escapeHtml(name)}"><i class="tag icon"></i>${text}</span>`;
    }).join('');
  }

  /* -------------------------------------------------------------
   * PICKER: Fomantic multiple search dropdown with additions
   * ------------------------------------------------------------- */

  function menuValues() {
    return registry.map(t => ({
      value: t.name,
      text: t.name,
      name: `<span class="ui empty circular mini ${t.color} label"></span>${escapeHtml(t.name)}`
    }));
  }

  /**
   * Turns an empty element into a tag picker.
   * @param {HTMLElement} el
   * @param {{ onChange?: (names: string[]) => void, placeholder?: string }} options
   */
  function createPicker(el, options = {}) {
    const $ = window.jQuery;
    el.classList.add('ui', 'fluid', 'multiple', 'search', 'selection', 'inverted', 'dropdown', 'tag-picker');
    el.innerHTML = `
      <input type="hidden">
      <i class="dropdown icon"></i>
      <div class="default text">${escapeHtml(options.placeholder || 'Add tags...')}</div>
      <div class="menu"></div>
    `;

    let silent = false;
    const $el = $(el);
    $el.dropdown({
      values: menuValues(),
      allowAdditions: true,
      hideAdditions: false,
      forceSelection: false,
      fullTextSearch: 'exact',
      delimiter: ',',
      direction: 'auto',
      message: {
        addResult: 'Create tag <b>{term}</b>',
        noResults: 'No tags yet: type a name to create one'
      },
      onLabelCreate(value) {
        const color = find(value) ? colorOf(value) : 'grey';
        return this.addClass(color);
      },
      onChange() {
        if (!silent && options.onChange) options.onChange(getValue());
      }
    });

    function getValue() {
      const raw = $el.dropdown('get values');
      const list = normalizeList(Array.isArray(raw) ? raw : String(raw || '').split(','));
      const searchInput = el.querySelector('input.search');
      if (searchInput && searchInput.value && searchInput.value.trim()) {
        const pending = normalizeName(searchInput.value.trim());
        if (pending && !list.some(n => n.toLowerCase() === pending.toLowerCase())) {
          list.push(pending);
        }
      }
      return list;
    }

    function setValue(names) {
      silent = true;
      $el.dropdown('clear', true);
      $el.dropdown('setup menu', { values: menuValues() });
      const list = normalizeList(names);
      if (list.length) $el.dropdown('set exactly', list);
      silent = false;
    }

    /** Reloads suggestions after the registry changed, keeping the selection */
    function refresh() {
      setValue(getValue());
    }

    function focus() {
      const input = el.querySelector('input.search');
      if (input) input.focus();
    }

    return { getValue, setValue, refresh, focus, el };
  }

  window.VG.Tags = {
    COLORS,
    normalizeName,
    normalizeList,
    find,
    getAll,
    colorOf,
    ensure,
    load,
    clear,
    usage,
    renderLabels,
    createPicker
  };
})();
