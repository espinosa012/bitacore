const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserModules } = require('./helpers');

function setupModalsTestEnvironment(initialTasks = []) {
  const elements = new Map();
  const listenersMap = new Map();

  function getOrCreateElement(id, tag = 'div') {
    if (!elements.has(id)) {
      const classes = new Set();
      const children = [];
      const attrs = {};
      const listeners = {};
      listenersMap.set(id, listeners);

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
        dispatchEvent: (event) => {
          const type = event.type || (event.key ? 'keydown' : 'click');
          event.type = type;
          event.target = event.target || el;
          (listeners[type] || []).forEach(fn => fn(event));
        },
        appendChild: (child) => {
          children.push(child);
          return child;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        focus: () => {},
        reset: () => { el.value = ''; }
      };
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const document = {
    createElement: (tag) => getOrCreateElement(`_anon_${Math.random()}`, tag),
    getElementById: (id) => getOrCreateElement(id),
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const CSS = { escape: (s) => s };

  let modalVisibility = new Map();
  let openedTaskPage = null;
  let persistedChanges = [];

  const extraGlobals = {
    document,
    localStorage,
    CSS
  };

  const { VG } = loadBrowserModules([
    'js/constants.js'
  ], extraGlobals);

  VG.UI = {
    initModal: () => {},
    showModal: (el) => { modalVisibility.set(el.id, true); },
    hideModal: (el) => { modalVisibility.set(el.id, false); },
    isModalVisible: (el) => modalVisibility.get(el.id) === true,
    toast: () => {},
    dialog: async () => []
  };

  VG.Attachments = {};
  VG.Markdown = {
    createEditor: () => ({
      codemirror: {
        refresh: () => {},
        clearHistory: () => {},
        getOption: () => ({}),
        setOption: () => {},
        getWrapperElement: () => ({ contains: () => false })
      },
      isPreviewActive: () => false,
      value: () => ''
    }),
    getValue: (ed, fallback) => (fallback ? fallback.value : ''),
    setValue: (ed, fallback, val) => { if (fallback) fallback.value = val; },
    toPlainText: (s) => s || ''
  };

  VG.Tags = {
    createPicker: () => ({
      getValue: () => [],
      setValue: () => {}
    }),
    ensure: (arr) => arr || [],
    renderLabels: () => ''
  };

  let currentTasks = [...initialTasks];
  VG.App = {
    getTasks: () => currentTasks,
    setTasks: (t) => { currentTasks = t; },
    getActiveProjectId: () => 'proj-1',
    getNextTaskId: () => String(currentTasks.length + 1),
    persistChanges: (msg) => { persistedChanges.push(msg); }
  };
  VG.Board = {
    renderBoard: () => {}
  };
  VG.TaskPage = {
    open: (taskId, draft = null) => {
      openedTaskPage = { taskId, draft };
    }
  };

  // Pre-create standard modal elements
  getOrCreateElement('modalCreateOverlay');
  getOrCreateElement('modalEditOverlay');
  getOrCreateElement('createTaskForm', 'form');
  getOrCreateElement('newTaskName', 'input');
  getOrCreateElement('newTaskPriority', 'select').value = 'medium';
  getOrCreateElement('newTaskState', 'select').value = 'planned';
  getOrCreateElement('newTaskType', 'select').value = 'task';
  getOrCreateElement('newTaskAssignee', 'select').value = '';
  getOrCreateElement('newTaskDesc', 'textarea');
  getOrCreateElement('newTaskOpenspecId', 'input');
  getOrCreateElement('editTaskName', 'input');
  getOrCreateElement('editTaskPriority', 'select');
  getOrCreateElement('editTaskState', 'select');
  getOrCreateElement('editTaskType', 'select');
  getOrCreateElement('editTaskAssignee', 'select');
  getOrCreateElement('editTaskDesc', 'textarea');
  getOrCreateElement('editTaskOpenspecId', 'input');
  getOrCreateElement('btnOpenTaskPage', 'button');
  getOrCreateElement('btnCreateAndOpenPage', 'button');

  // Load modals.js now that dependencies and DOM elements are registered
  loadBrowserModules(['js/modals.js'], { ...extraGlobals, window: { VG } });

  VG.Modals.initModals();

  return {
    VG,
    elements,
    getOrCreateElement,
    getOpenedTaskPage: () => openedTaskPage,
    resetOpenedTaskPage: () => { openedTaskPage = null; },
    getPersistedChanges: () => persistedChanges,
    isModalVisible: (id) => modalVisibility.get(id) === true
  };
}

test('modal edit overlay triggers openTaskPage on Ctrl/Cmd+Shift+Enter and Alt+Enter', () => {
  const sampleTask = {
    id: '101',
    name: 'Sample Task',
    status: 'in progress',
    priority: 'high',
    type: 'task',
    description: 'Original description'
  };

  const env = setupModalsTestEnvironment([sampleTask]);
  env.VG.Modals.openEditModal(sampleTask);

  const editOverlay = env.getOrCreateElement('modalEditOverlay');
  const editTaskName = env.getOrCreateElement('editTaskName');
  editTaskName.value = 'Updated Task Name';

  // 1. Test Ctrl+Shift+Enter
  const event1 = {
    key: 'Enter',
    ctrlKey: true,
    shiftKey: true,
    preventDefault: () => {},
    target: editTaskName
  };
  editOverlay.dispatchEvent(event1);

  assert.ok(env.getOpenedTaskPage(), 'TaskPage.open should have been called');
  assert.equal(env.getOpenedTaskPage().taskId, '101');
  assert.equal(env.getOpenedTaskPage().draft.name, 'Updated Task Name');

  // 2. Test Alt+Enter
  env.resetOpenedTaskPage();
  env.VG.Modals.openEditModal(sampleTask);

  const event2 = {
    key: 'Enter',
    altKey: true,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => {},
    target: editTaskName
  };
  editOverlay.dispatchEvent(event2);

  assert.ok(env.getOpenedTaskPage(), 'TaskPage.open should have been called on Alt+Enter');
  assert.equal(env.getOpenedTaskPage().taskId, '101');
});

test('modal edit overlay saves changes on Shift+Enter from title input, but not from multiline editor', () => {
  const sampleTask = {
    id: '102',
    name: 'Initial Name',
    status: 'planned',
    priority: 'medium',
    type: 'task'
  };

  const env = setupModalsTestEnvironment([sampleTask]);
  env.VG.Modals.openEditModal(sampleTask);

  const editOverlay = env.getOrCreateElement('modalEditOverlay');
  const editTaskName = env.getOrCreateElement('editTaskName');
  editTaskName.value = 'Saved with Shift+Enter';

  // Pressing Shift+Enter in title input saves
  const saveEvent = {
    key: 'Enter',
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
    target: editTaskName
  };
  editOverlay.dispatchEvent(saveEvent);

  assert.equal(sampleTask.name, 'Saved with Shift+Enter');

  // Pressing Shift+Enter inside textarea/multiline target does NOT trigger save
  env.VG.Modals.openEditModal(sampleTask);
  const descTarget = env.getOrCreateElement('editTaskDesc', 'textarea');

  let savedBefore = env.getPersistedChanges().length;
  const descEvent = {
    key: 'Enter',
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
    target: descTarget
  };
  editOverlay.dispatchEvent(descEvent);

  assert.equal(env.getPersistedChanges().length, savedBefore, 'Should not save when Shift+Enter is pressed in textarea');
});

test('modal create overlay creates task and opens page on Ctrl/Cmd+Shift+Enter or Alt+Enter', async () => {
  const env = setupModalsTestEnvironment([]);
  env.VG.Modals.openCreateModal('planned');

  const createOverlay = env.getOrCreateElement('modalCreateOverlay');
  const nameInput = env.getOrCreateElement('newTaskName');
  nameInput.value = 'Brand New Task';

  // Press Ctrl+Shift+Enter
  const event = {
    key: 'Enter',
    metaKey: true,
    shiftKey: true,
    preventDefault: () => {},
    target: nameInput
  };
  createOverlay.dispatchEvent(event);

  assert.ok(env.getOpenedTaskPage(), 'TaskPage.open should be called when creating task with shortcut');
  const createdTasks = env.VG.App.getTasks();
  assert.equal(createdTasks.length, 1);
  assert.equal(createdTasks[0].name, 'Brand New Task');
  assert.equal(env.getOpenedTaskPage().taskId, createdTasks[0].id);
});

test('btnCreateAndOpenPage button creates task and opens its page', async () => {
  const env = setupModalsTestEnvironment([]);
  env.VG.Modals.openCreateModal('planned');

  const nameInput = env.getOrCreateElement('newTaskName');
  nameInput.value = 'Task from Button';

  const btn = env.getOrCreateElement('btnCreateAndOpenPage');
  btn.dispatchEvent({ type: 'click', preventDefault: () => {} });

  assert.ok(env.getOpenedTaskPage(), 'TaskPage.open should be called when clicking btnCreateAndOpenPage');
  const createdTasks = env.VG.App.getTasks();
  assert.equal(createdTasks.length, 1);
  assert.equal(createdTasks[0].name, 'Task from Button');
});
