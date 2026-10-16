/**
 * vg-task-manager: MongoDB Synchronization Client
 * Communicates with the backend server to synchronize tasks and attachments
 * with MongoDB Atlas database 'vg-task-manager' and collection 'tasks'.
 */
(function() {
  window.VG = window.VG || {};

  const STORAGE_KEY_URI = 'vg_mongo_uri';
  const DEFAULT_URI = '';
  const DEFAULT_BACKEND_URL = 'http://localhost:8766';
  const BACKEND_URL_KEY = 'vg_backend_url';

  let isConnected = false;
  let currentDb = null;
  let maskedUri = null;
  let taskCount = 0;
  const connectionListeners = [];

  function isServedByBackend() {
    const host = window.location.hostname;
    return window.location.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
  }

  function getApiBaseUrl() {
    if (isServedByBackend()) return '';
    let stored = null;
    try { stored = localStorage.getItem(BACKEND_URL_KEY); } catch (e) {}
    return (stored || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  }

  function apiUrl(path) {
    const base = getApiBaseUrl();
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return base ? `${base}${cleanPath}` : cleanPath;
  }

  // Writes are chained so requests never land out of order
  let writeQueue = Promise.resolve();
  function enqueueWrite(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
  }

  function onConnectionChange(fn) {
    if (typeof fn === 'function') {
      connectionListeners.push(fn);
    }
  }

  function notifyChange() {
    const state = { isConnected, currentDb, maskedUri, taskCount };
    connectionListeners.forEach(fn => {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  function getStoredUri() {
    try {
      return localStorage.getItem(STORAGE_KEY_URI) || '';
    } catch (e) {
      return '';
    }
  }

  function setStoredUri(uri) {
    try {
      if (uri) {
        localStorage.setItem(STORAGE_KEY_URI, uri);
      } else {
        localStorage.removeItem(STORAGE_KEY_URI);
      }
    } catch (e) {}
  }

  /**
   * Check connection status with backend
   */
  async function checkStatus() {
    try {
      const res = await fetch(apiUrl('/api/mongo/status'), { cache: 'no-store' });
      if (!res.ok) {
        isConnected = false;
        notifyChange();
        return { connected: false };
      }
      const data = await res.json();
      isConnected = !!data.connected;
      currentDb = data.database || null;
      maskedUri = data.maskedUri || null;
      taskCount = typeof data.taskCount === 'number' ? data.taskCount : 0;
      notifyChange();
      return data;
    } catch (e) {
      isConnected = false;
      notifyChange();
      return { connected: false };
    }
  }

  /**
   * Connect to MongoDB with URI
   */
  async function connect(uri) {
    const targetUri = (uri || '').trim().replace(/^["']|["']$/g, '') || DEFAULT_URI;
    if (!targetUri) {
      throw new Error('Please enter your MongoDB connection string (e.g. mongodb+srv://admin:password@cluster.mongodb.net/).');
    }

    let res;
    try {
      res = await fetch(apiUrl('/api/mongo/connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: targetUri })
      });
    } catch (netErr) {
      if (!isServedByBackend()) {
        throw new Error(
          `Could not connect to local server at ${getApiBaseUrl()}.\n\n` +
          'To connect to MongoDB Atlas, please start the server with "npm start" and open http://localhost:8766/ in your browser.'
        );
      }
      throw new Error(`Cannot reach server: ${netErr.message}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (jsonErr) {
      throw new Error(`Server returned HTTP ${res.status} (invalid JSON). Make sure you access http://localhost:8766/ directly.`);
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to connect to MongoDB');
    }

    isConnected = true;
    currentDb = data.database || 'vg-task-manager';
    maskedUri = data.maskedUri || '';
    taskCount = typeof data.taskCount === 'number' ? data.taskCount : 0;
    setStoredUri(targetUri);
    notifyChange();
    return data;
  }

  /**
   * Disconnect from MongoDB
   */
  async function disconnect() {
    try {
      await fetch(apiUrl('/api/mongo/disconnect'), { method: 'POST' });
    } catch (e) {}
    isConnected = false;
    currentDb = null;
    maskedUri = null;
    taskCount = 0;
    setStoredUri('');
    notifyChange();
    return { ok: true };
  }

  /**
   * Load tasks from MongoDB
   */
  async function loadTasks() {
    if (!isConnected) {
      throw new Error('Not connected to MongoDB. Please connect first.');
    }
    const res = await fetch(apiUrl('/api/tasks'), { cache: 'no-store' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Error loading tasks (HTTP ${res.status})`);
    }
    const data = await res.json();
    return data; // { tags: [...], tasks: [...] }
  }

  /**
   * Save board document ({ tags, tasks }) to MongoDB
   */
  async function saveTasks(doc) {
    if (!isConnected) return false;
    return enqueueWrite(async () => {
      try {
        const payload = doc || window.VG.App.buildDocument();
        const res = await fetch(apiUrl('/api/tasks'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return res.ok;
      } catch (err) {
        console.warn('Could not save tasks to MongoDB:', err);
        return false;
      }
    });
  }

  /**
   * Delete single task from MongoDB
   */
  async function deleteTask(taskId) {
    if (!isConnected) return false;
    return enqueueWrite(async () => {
      try {
        const res = await fetch(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}`), { method: 'DELETE' });
        return res.ok;
      } catch (err) {
        console.warn(`Could not delete task ${taskId} from MongoDB:`, err);
        return false;
      }
    });
  }

  /**
   * Upload an attachment file to MongoDB
   */
  async function uploadAttachment(taskId, filename, fileOrBlob) {
    if (!isConnected) return false;
    return enqueueWrite(async () => {
      try {
        const url = apiUrl(`/api/attachments/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`);
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': fileOrBlob.type || 'application/octet-stream'
          },
          body: fileOrBlob
        });
        return res.ok;
      } catch (err) {
        console.warn(`Could not upload attachment "${filename}" for task ${taskId}:`, err);
        return false;
      }
    });
  }

  /**
   * Delete an attachment file from MongoDB
   */
  async function deleteAttachment(taskId, filename) {
    if (!isConnected) return false;
    return enqueueWrite(async () => {
      try {
        const url = apiUrl(`/api/attachments/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`);
        const res = await fetch(url, { method: 'DELETE' });
        return res.ok;
      } catch (err) {
        console.warn(`Could not delete attachment "${filename}" from MongoDB:`, err);
        return false;
      }
    });
  }

  window.VG.MongoSync = {
    DEFAULT_URI,
    apiUrl,
    getApiBaseUrl,
    isServedByBackend,
    isConnected: () => isConnected,
    getCurrentDb: () => currentDb,
    getMaskedUri: () => maskedUri,
    getTaskCount: () => taskCount,
    getStoredUri,
    setStoredUri,
    checkStatus,
    connect,
    disconnect,
    loadTasks,
    saveTasks,
    deleteTask,
    uploadAttachment,
    deleteAttachment,
    onConnectionChange
  };
})();
