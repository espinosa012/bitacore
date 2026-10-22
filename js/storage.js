/**
 * bitacore: Storage (IndexedDB for attachment files + localStorage for tasks metadata)
 */
(function() {
  window.VG = window.VG || {};

  const DB_NAME = 'vg_task_manager_db';
  const DB_VERSION = 1;
  const STORE_ATTACHMENTS = 'attachments';

  const STORAGE_KEY_TASKS = 'vg_task_manager_tasks';
  const STORAGE_KEY_COLLAPSED = 'vg_task_manager_collapsed_cols';

  let dbPromise = null;

  function initDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB is not supported in this browser environment.');
        return resolve(null);
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_ATTACHMENTS)) {
          db.createObjectStore(STORE_ATTACHMENTS, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        resolve(null);
      };
    });

    return dbPromise;
  }

  function makeKey(taskId, filename) {
    return `${taskId}/${filename}`;
  }

  async function saveAttachmentBlob(taskId, filename, blob) {
    const db = await initDb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ATTACHMENTS], 'readwrite');
      const store = tx.objectStore(STORE_ATTACHMENTS);
      const record = {
        key: makeKey(taskId, filename),
        taskId,
        filename,
        blob,
        updatedAt: new Date().toISOString()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = (err) => {
        console.warn('Failed to save attachment blob to IndexedDB:', err);
        resolve(false);
      };
    });
  }

  async function getAttachmentBlob(taskId, filename) {
    const db = await initDb();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ATTACHMENTS], 'readonly');
      const store = tx.objectStore(STORE_ATTACHMENTS);
      const req = store.get(makeKey(taskId, filename));
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve(req.result.blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  }

  async function deleteAttachmentBlob(taskId, filename) {
    const db = await initDb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ATTACHMENTS], 'readwrite');
      const store = tx.objectStore(STORE_ATTACHMENTS);
      const req = store.delete(makeKey(taskId, filename));
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  async function deleteTaskAttachments(taskId) {
    const db = await initDb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ATTACHMENTS], 'readwrite');
      const store = tx.objectStore(STORE_ATTACHMENTS);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.taskId === taskId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      req.onerror = () => resolve(false);
    });
  }

  async function getAllAttachmentBlobs() {
    const db = await initDb();
    if (!db) return {};

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ATTACHMENTS], 'readonly');
      const store = tx.objectStore(STORE_ATTACHMENTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const result = {};
        (req.result || []).forEach(r => {
          result[r.key] = r.blob;
        });
        resolve(result);
      };
      req.onerror = () => resolve({});
    });
  }

  async function clearAllAttachments() {
    const db = await initDb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ATTACHMENTS], 'readwrite');
      const store = tx.objectStore(STORE_ATTACHMENTS);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  /*
   * Attachment blobs are shared by every open tab of the app, so they are only
   * wiped when this is the sole tab. Each tab holds a shared Web Lock for its
   * lifetime; counting holders tells how many tabs are open.
   */
  const TAB_LOCK = 'vg_task_manager_tab';
  let tabLockPromise = null;

  /** Resolves once this tab holds its lock, so isOnlyOpenTab() counts it */
  function registerTab() {
    if (tabLockPromise) return tabLockPromise;
    if (!navigator.locks) return (tabLockPromise = Promise.resolve());
    tabLockPromise = new Promise(granted => {
      navigator.locks.request(TAB_LOCK, { mode: 'shared' }, () => {
        granted();
        return new Promise(() => {}); // held until the tab closes
      }).catch(granted);
    });
    return tabLockPromise;
  }

  async function isOnlyOpenTab() {
    if (!navigator.locks || !navigator.locks.query) return false;
    await registerTab();
    try {
      const state = await navigator.locks.query();
      const holders = (state.held || []).filter(l => l.name === TAB_LOCK).length;
      return holders <= 1;
    } catch (e) {
      return false;
    }
  }

  /** Drops all attachment blobs unless another tab may still be using them */
  async function clearAttachmentsIfSoleTab() {
    if (!(await isOnlyOpenTab())) return false;
    return clearAllAttachments();
  }

  /* LocalStorage helpers */
  function loadLocalTasks() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_TASKS);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch (e) {
      console.warn('Error reading tasks from localStorage:', e);
      return null;
    }
  }

  function saveLocalTasks(tasks) {
    try {
      localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks, null, 2));
      return true;
    } catch (e) {
      console.warn('Error saving tasks to localStorage:', e);
      return false;
    }
  }

  function clearLocalTasks() {
    localStorage.removeItem(STORAGE_KEY_TASKS);
  }

  function loadCollapsedColumns() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COLLAPSED);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveCollapsedColumns(colSet) {
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify([...colSet]));
    } catch (e) {}
  }

  window.VG.Storage = {
    initDb,
    saveAttachmentBlob,
    getAttachmentBlob,
    deleteAttachmentBlob,
    deleteTaskAttachments,
    getAllAttachmentBlobs,
    clearAllAttachments,
    registerTab,
    clearAttachmentsIfSoleTab,
    loadLocalTasks,
    saveLocalTasks,
    clearLocalTasks,
    loadCollapsedColumns,
    saveCollapsedColumns
  };
})();
