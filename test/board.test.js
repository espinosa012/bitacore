const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserModules } = require('./helpers');

function setupBoardTestEnvironment(tasks) {
  const elements = new Map();

  function getOrCreateElement(id, tag = 'div') {
    if (!elements.has(id)) {
      const classes = new Set();
      const children = [];
      const attrs = {};
      const listeners = {};
      const el = {
        id,
        tagName: tag.toUpperCase(),
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        checked: false,
        style: {},
        title: '',
        children,
        classList: {
          add: (...c) => c.forEach(x => classes.add(x)),
          remove: (...c) => c.forEach(x => classes.delete(x)),
          toggle: (c, force) => {
            if (force === undefined) {
              if (classes.has(c)) classes.delete(c);
              else classes.add(c);
            } else if (force) {
              classes.add(c);
            } else {
              classes.delete(c);
            }
          },
          contains: (c) => classes.has(c)
        },
        setAttribute: (k, v) => { attrs[k] = String(v); },
        getAttribute: (k) => attrs[k] || null,
        addEventListener: (type, fn) => {
          listeners[type] = listeners[type] || [];
          listeners[type].push(fn);
        },
        removeEventListener: () => {},
        appendChild: (child) => {
          children.push(child);
          return child;
        },
        querySelector: () => null,
        querySelectorAll: () => []
      };
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const document = {
    createElement: (tag) => {
      const el = getOrCreateElement(`_anon_${Math.random()}`, tag);
      return el;
    },
    getElementById: (id) => getOrCreateElement(id),
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const CSS = {
    escape: (s) => s
  };

  const extraGlobals = {
    document,
    localStorage,
    CSS
  };

  const { VG } = loadBrowserModules([
    'js/constants.js',
    'js/storage.js',
    'js/markdown.js',
    'js/tags.js',
    'js/board.js'
  ], extraGlobals);

  let currentTasks = [...tasks];
  VG.App = {
    getTasks: () => currentTasks,
    setTasks: (t) => { currentTasks = t; },
    persistChanges: () => {}
  };

  // Pre-initialize criterion checkboxes to checked (default 4/4)
  getOrCreateElement('chkCriteriaAssignee').checked = true;
  getOrCreateElement('chkCriteriaCreator').checked = true;
  getOrCreateElement('chkCriteriaCommenter').checked = true;
  getOrCreateElement('chkCriteriaUploader').checked = true;

  // Initialize filter defaults
  getOrCreateElement('priorityFilter').value = 'all';
  getOrCreateElement('typeFilter').value = 'all';
  getOrCreateElement('tagFilter').value = 'all';
  getOrCreateElement('userFilter').value = 'all';
  getOrCreateElement('searchInput').value = '';

  return { VG, elements, getOrCreateElement };
}

const sampleTasks = [
  {
    id: '1',
    name: 'Task 1: Setup database',
    description: 'Initial DB schema',
    status: 'planned',
    priority: 'high',
    type: 'task',
    tags: ['backend', 'db'],
    assignee: 'alice',
    reporter: 'bob',
    favorite: false
  },
  {
    id: '2',
    name: 'Task 2: UI redesign',
    description: 'Fomantic UI updates',
    status: 'planned',
    priority: 'low',
    type: 'feature',
    tags: ['frontend', 'ui'],
    assignee: 'bob',
    reporter: 'alice',
    favorite: true
  },
  {
    id: '3',
    name: 'Task 3: Auth bugfix',
    description: 'Fix token issue',
    status: 'in progress',
    priority: 'blocker',
    type: 'bug',
    tags: ['backend', 'security'],
    assignee: 'alice',
    reporter: 'alice',
    favorite: true
  },
  {
    id: '4',
    name: 'Task 4: Documentation',
    description: 'Write API specs',
    status: 'done',
    priority: 'medium',
    type: 'task',
    tags: ['docs'],
    assignee: 'charlie',
    reporter: 'bob',
    favorite: false
  }
];

test('board column badges show total count when no filters are applied', () => {
  const { VG, elements } = setupBoardTestEnvironment(sampleTasks);

  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 2);
  assert.equal(elements.get('badge-in-progress').textContent, 1);
  assert.equal(elements.get('badge-in-review').textContent, 0);
  assert.equal(elements.get('badge-done').textContent, 1);
  assert.equal(elements.get('badge-blocked').textContent, 0);
});

test('board column badges update when searching by text', () => {
  const { VG, elements, getOrCreateElement } = setupBoardTestEnvironment(sampleTasks);

  // Search matching "database" (only Task 1 in planned)
  getOrCreateElement('searchInput').value = 'database';
  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 1);
  assert.equal(elements.get('badge-in-progress').textContent, 0);
  assert.equal(elements.get('badge-done').textContent, 0);

  // Search matching "backend" in tags (Task 1 in planned, Task 3 in in progress)
  getOrCreateElement('searchInput').value = 'backend';
  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 1);
  assert.equal(elements.get('badge-in-progress').textContent, 1);
  assert.equal(elements.get('badge-done').textContent, 0);

  // Search matching nothing
  getOrCreateElement('searchInput').value = 'nonexistentxyz';
  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 0);
  assert.equal(elements.get('badge-in-progress').textContent, 0);
  assert.equal(elements.get('badge-done').textContent, 0);
});

test('board column badges update when favorite filter is toggled', () => {
  const { VG, elements } = setupBoardTestEnvironment(sampleTasks);

  // Initially unfiltered
  VG.Board.renderBoard();
  assert.equal(elements.get('badge-planned').textContent, 2);
  assert.equal(elements.get('badge-in-progress').textContent, 1);
  assert.equal(elements.get('badge-done').textContent, 1);

  // Toggle favorite filter on (Task 2 in planned, Task 3 in in progress are favorites)
  VG.Board.toggleFavoriteFilter();

  assert.equal(elements.get('badge-planned').textContent, 1);
  assert.equal(elements.get('badge-in-progress').textContent, 1);
  assert.equal(elements.get('badge-done').textContent, 0);

  // Toggle favorite filter off -> returns to full counts
  VG.Board.toggleFavoriteFilter();

  assert.equal(elements.get('badge-planned').textContent, 2);
  assert.equal(elements.get('badge-in-progress').textContent, 1);
  assert.equal(elements.get('badge-done').textContent, 1);
});

test('board column badges update when filtering by priority, type, tag, or user', () => {
  const { VG, elements, getOrCreateElement } = setupBoardTestEnvironment(sampleTasks);

  // Priority filter: blocker (Task 3 in in progress)
  getOrCreateElement('priorityFilter').value = 'blocker';
  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 0);
  assert.equal(elements.get('badge-in-progress').textContent, 1);
  assert.equal(elements.get('badge-done').textContent, 0);

  // Reset priority, filter by type: bug (Task 3 in in progress)
  getOrCreateElement('priorityFilter').value = 'all';
  getOrCreateElement('typeFilter').value = 'bug';
  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 0);
  assert.equal(elements.get('badge-in-progress').textContent, 1);
  assert.equal(elements.get('badge-done').textContent, 0);

  // Reset type, filter by tag: frontend (Task 2 in planned)
  getOrCreateElement('typeFilter').value = 'all';
  getOrCreateElement('tagFilter').value = 'frontend';
  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 1);
  assert.equal(elements.get('badge-in-progress').textContent, 0);
  assert.equal(elements.get('badge-done').textContent, 0);

  // Reset tag, filter by user: charlie (Task 4 in done)
  getOrCreateElement('tagFilter').value = 'all';
  getOrCreateElement('userFilter').value = 'charlie';
  VG.Board.renderBoard();

  assert.equal(elements.get('badge-planned').textContent, 0);
  assert.equal(elements.get('badge-in-progress').textContent, 0);
  assert.equal(elements.get('badge-done').textContent, 1);
});
