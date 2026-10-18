/**
 * vg-task-manager: MongoDB Synchronization Client (vg-mongo-proxy)
 * Communicates directly with the FastAPI vg-mongo-proxy to manage MongoDB operations
 * and GridFS file streaming, fully compatible with static hosting (GitHub Pages).
 */
(function() {
  window.VG = window.VG || {};

  const STORAGE_KEY_PROXY_URL = 'vg_proxy_url';
  const STORAGE_KEY_API_KEY = 'vg_proxy_api_key';
  const STORAGE_KEY_DB = 'vg_mongo_db';
  const STORAGE_KEY_URI = 'vg_mongo_uri';

  // Default connection parameters (can be configured or customized)
  const DEFAULT_PROXY_URL = '';
  const DEFAULT_API_KEY = '';
  const DEFAULT_DB = 'vg-task-manager';
  const DEFAULT_URI = '';

  let isConnected = false;
  let proxyUrl = '';
  let apiKey = '';
  let currentDb = DEFAULT_DB;
  let mongoUri = '';
  let taskCount = 0;
  const connectionListeners = [];

  function sanitizeUrl(url) {
    if (!url) return '';
    return String(url).trim().replace(/\/+$/, '');
  }

  function getStoredConfig() {
    try {
      return {
        proxyUrl: localStorage.getItem(STORAGE_KEY_PROXY_URL) || DEFAULT_PROXY_URL,
        apiKey: localStorage.getItem(STORAGE_KEY_API_KEY) || DEFAULT_API_KEY,
        database: localStorage.getItem(STORAGE_KEY_DB) || DEFAULT_DB,
        mongoUri: localStorage.getItem(STORAGE_KEY_URI) || DEFAULT_URI
      };
    } catch (e) {
      return {
        proxyUrl: DEFAULT_PROXY_URL,
        apiKey: DEFAULT_API_KEY,
        database: DEFAULT_DB,
        mongoUri: DEFAULT_URI
      };
    }
  }

  function setStoredConfig(cfg) {
    try {
      if (!cfg) {
        localStorage.removeItem(STORAGE_KEY_PROXY_URL);
        localStorage.removeItem(STORAGE_KEY_API_KEY);
        localStorage.removeItem(STORAGE_KEY_DB);
        localStorage.removeItem(STORAGE_KEY_URI);
        return;
      }
      if (cfg.proxyUrl !== undefined) {
        if (cfg.proxyUrl) localStorage.setItem(STORAGE_KEY_PROXY_URL, sanitizeUrl(cfg.proxyUrl));
        else localStorage.removeItem(STORAGE_KEY_PROXY_URL);
      }
      if (cfg.apiKey !== undefined) {
        if (cfg.apiKey) localStorage.setItem(STORAGE_KEY_API_KEY, cfg.apiKey.trim());
        else localStorage.removeItem(STORAGE_KEY_API_KEY);
      }
      if (cfg.database !== undefined) {
        if (cfg.database) localStorage.setItem(STORAGE_KEY_DB, cfg.database.trim());
        else localStorage.removeItem(STORAGE_KEY_DB);
      }
      if (cfg.mongoUri !== undefined) {
        if (cfg.mongoUri) localStorage.setItem(STORAGE_KEY_URI, cfg.mongoUri.trim());
        else localStorage.removeItem(STORAGE_KEY_URI);
      }
    } catch (e) {}
  }

  // Initialize state from storage
  const initial = getStoredConfig();
  proxyUrl = sanitizeUrl(initial.proxyUrl);
  apiKey = initial.apiKey.trim();
  currentDb = (initial.database || DEFAULT_DB).trim();
  mongoUri = (initial.mongoUri || DEFAULT_URI).trim();

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
    const state = {
      isConnected,
      proxyUrl,
      currentDb,
      taskCount,
      maskedApiKey: apiKey ? `${apiKey.slice(0, 3)}••••${apiKey.slice(-3)}` : ''
    };
    connectionListeners.forEach(fn => {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  function getHeaders(withContentType = true) {
    const headers = {};
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    if (mongoUri) {
      headers['x-mongo-uri'] = mongoUri;
    }
    if (withContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  /**
   * Execute a Data API action against vg-mongo-proxy (/action/*)
   */
  async function action(actionName, collection, payload = {}) {
    if (!proxyUrl) {
      throw new Error('Proxy URL is not configured. Please connect to vg-mongo-proxy first.');
    }

    const cleanAction = actionName.replace(/^\/+/, '');
    const url = `${proxyUrl}/action/${cleanAction}`;

    const body = {
      database: currentDb || DEFAULT_DB,
      collection: collection,
      ...payload
    };

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(body)
      });
    } catch (netErr) {
      throw new Error(`Cannot reach vg-mongo-proxy at ${proxyUrl}: ${netErr.message}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (jsonErr) {
      throw new Error(`Proxy returned HTTP ${res.status} (invalid JSON response)`);
    }

    if (!res.ok) {
      const msg = (data && (data.detail || data.error || data.message))
        ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
        : `Request failed with HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  /**
   * Check connection status with vg-mongo-proxy and MongoDB Atlas
   */
  async function checkStatus() {
    const cfg = getStoredConfig();
    proxyUrl = sanitizeUrl(cfg.proxyUrl);
    apiKey = (cfg.apiKey || '').trim();
    currentDb = (cfg.database || DEFAULT_DB).trim();
    mongoUri = (cfg.mongoUri || '').trim();

    if (!proxyUrl || !apiKey) {
      isConnected = false;
      notifyChange();
      return { connected: false, reason: 'unconfigured' };
    }

    try {
      // 1. Health check on the proxy service
      const healthRes = await fetch(`${proxyUrl}/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });

      if (!healthRes.ok) {
        isConnected = false;
        notifyChange();
        return { connected: false, error: `Proxy health check returned HTTP ${healthRes.status}` };
      }

      const healthData = await healthRes.json().catch(() => ({}));
      if (healthData.status !== 'healthy' || healthData.database !== 'connected') {
        isConnected = false;
        notifyChange();
        return { connected: false, error: healthData.error || 'Proxy database is disconnected' };
      }

      // 2. Validate API key and count tasks in collection
      const countRes = await action('count', 'tasks', { filter: {} });
      taskCount = typeof countRes.count === 'number' ? countRes.count : 0;
      isConnected = true;
      notifyChange();
      return {
        connected: true,
        proxyUrl,
        database: currentDb,
        taskCount
      };
    } catch (e) {
      console.warn('[MongoSync] checkStatus failed:', e.message);
      isConnected = false;
      notifyChange();
      return { connected: false, error: e.message };
    }
  }

  /**
   * Connect to vg-mongo-proxy with credentials
   */
  async function connect(config = {}) {
    const targetProxy = sanitizeUrl(config.proxyUrl || proxyUrl || DEFAULT_PROXY_URL);
    const targetApiKey = (config.apiKey !== undefined ? config.apiKey : apiKey).trim();
    const targetDb = (config.database || currentDb || DEFAULT_DB).trim();
    const targetUri = (config.mongoUri !== undefined ? config.mongoUri : mongoUri).trim();

    if (!targetProxy) {
      throw new Error('Please enter the URL of your vg-mongo-proxy (e.g. https://api.tu-dominio.com).');
    }
    if (!targetApiKey) {
      throw new Error('Please enter your proxy API key (x-api-key).');
    }

    // Temporarily set credentials to test
    const oldProxy = proxyUrl;
    const oldKey = apiKey;
    const oldDb = currentDb;
    const oldUri = mongoUri;

    proxyUrl = targetProxy;
    apiKey = targetApiKey;
    currentDb = targetDb;
    mongoUri = targetUri;

    try {
      // 1. Health check
      let healthRes;
      try {
        healthRes = await fetch(`${proxyUrl}/health`, { cache: 'no-store' });
      } catch (err) {
        throw new Error(`Could not reach proxy at ${proxyUrl}. Check URL and CORS settings.`);
      }

      if (!healthRes.ok) {
        throw new Error(`Proxy returned HTTP ${healthRes.status} from /health`);
      }

      const healthData = await healthRes.json().catch(() => ({}));
      if (healthData.status !== 'healthy' || healthData.database !== 'connected') {
        throw new Error(healthData.error || 'The proxy reports MongoDB is not connected.');
      }

      // 2. Authenticated test query
      const countRes = await action('count', 'tasks', { filter: {} });
      taskCount = typeof countRes.count === 'number' ? countRes.count : 0;

      isConnected = true;
      setStoredConfig({
        proxyUrl,
        apiKey,
        database: currentDb,
        mongoUri
      });

      notifyChange();
      return {
        ok: true,
        proxyUrl,
        database: currentDb,
        taskCount
      };
    } catch (err) {
      // Restore previous state on failure
      proxyUrl = oldProxy;
      apiKey = oldKey;
      currentDb = oldDb;
      mongoUri = oldUri;
      isConnected = false;
      notifyChange();
      throw err;
    }
  }

  /**
   * Disconnect from proxy
   */
  async function disconnect() {
    isConnected = false;
    taskCount = 0;
    setStoredConfig(null);
    notifyChange();
    return { ok: true };
  }

  /**
   * Load tasks and tags from MongoDB Atlas via vg-mongo-proxy
   */
  async function loadTasks() {
    if (!isConnected) {
      throw new Error('Not connected to MongoDB proxy. Please connect first.');
    }

    // 1. Find all tasks
    const tasksRes = await action('find', 'tasks', {
      filter: {},
      limit: 5000
    });
    const rawTasks = (tasksRes && Array.isArray(tasksRes.documents)) ? tasksRes.documents : [];

    const normalized = rawTasks.map(t => {
      const id = t.id || t._id;
      const copy = { ...t, id: String(id) };
      return copy;
    });
    taskCount = normalized.length;

    // 2. Find tag registry
    let tags = [];
    try {
      const tagDocRes = await action('findOne', 'tags', {
        filter: { _id: 'registry' }
      });
      if (tagDocRes && tagDocRes.document && Array.isArray(tagDocRes.document.tags)) {
        tags = tagDocRes.document.tags;
      }
    } catch (e) {
      console.warn('[MongoSync] Could not load tag registry:', e.message);
    }

    return { tags, tasks: normalized };
  }

  /**
   * Save board document ({ tags, tasks }) to MongoDB Atlas via vg-mongo-proxy
   */
  async function saveTasks(doc) {
    if (!isConnected) return false;

    return enqueueWrite(async () => {
      try {
        const payload = doc || window.VG.App.buildDocument();
        const tasksList = payload && Array.isArray(payload.tasks) ? payload.tasks : (Array.isArray(payload) ? payload : []);
        const tagsList = payload && Array.isArray(payload.tags) ? payload.tags : [];

        // 1. Save tags registry
        if (tagsList.length > 0 || (payload && payload.tags)) {
          await action('updateOne', 'tags', {
            filter: { _id: 'registry' },
            update: {
              $set: {
                _id: 'registry',
                tags: tagsList,
                updatedAt: { '$date': new Date().toISOString() }
              }
            },
            upsert: true
          });
        }

        // 2. Upsert tasks in batches
        const BATCH_SIZE = 8;
        for (let i = 0; i < tasksList.length; i += BATCH_SIZE) {
          const chunk = tasksList.slice(i, i + BATCH_SIZE);
          await Promise.all(chunk.map(t => {
            const id = t.id || t._id;
            const docToSave = { ...t, _id: id, id };
            return action('updateOne', 'tasks', {
              filter: { _id: id },
              update: { $set: docToSave },
              upsert: true
            });
          }));
        }

        // 3. Remove deleted tasks from collection
        const currentIds = tasksList.map(t => t.id || t._id);
        if (currentIds.length > 0) {
          await action('deleteMany', 'tasks', {
            filter: { _id: { $nin: currentIds } }
          });
        }

        taskCount = tasksList.length;
        notifyChange();
        return true;
      } catch (err) {
        console.warn('[MongoSync] Could not save tasks to MongoDB proxy:', err);
        return false;
      }
    });
  }

  /**
   * Delete single task from MongoDB Atlas
   */
  async function deleteTask(taskId) {
    if (!isConnected) return false;
    return enqueueWrite(async () => {
      try {
        await action('deleteOne', 'tasks', {
          filter: { _id: taskId }
        });
        taskCount = Math.max(0, taskCount - 1);
        notifyChange();
        return true;
      } catch (err) {
        console.warn(`[MongoSync] Could not delete task ${taskId}:`, err);
        return false;
      }
    });
  }

  /**
   * Upload an attachment file to MongoDB GridFS via /files/upload
   */
  async function uploadAttachment(taskId, filename, fileOrBlob) {
    if (!isConnected || !proxyUrl) return null;

    return enqueueWrite(async () => {
      try {
        const formData = new FormData();
        const fileToUpload = (fileOrBlob instanceof File)
          ? fileOrBlob
          : new File([fileOrBlob], filename, { type: fileOrBlob.type || 'application/octet-stream' });

        formData.append('file', fileToUpload);
        if (currentDb) {
          formData.append('database', currentDb);
        }

        const url = `${proxyUrl}/files/upload`;
        const res = await fetch(url, {
          method: 'POST',
          headers: getHeaders(false), // let browser set multipart boundary
          body: formData
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Upload failed with HTTP ${res.status}`);
        }

        const data = await res.json();
        return data; // { fileId, filename, contentType, length }
      } catch (err) {
        console.warn(`[MongoSync] Could not upload attachment "${filename}" for task ${taskId}:`, err);
        return null;
      }
    });
  }

  /**
   * Find a file's GridFS fileId by filename in fs.files (fallback for legacy files)
   */
  async function findFileByFilename(filename) {
    try {
      const res = await action('findOne', 'fs.files', {
        filter: { filename: filename }
      });
      return res && res.document ? res.document : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Build direct URL for downloading or viewing a GridFS file
   */
  function getFileUrl(fileId, download = false) {
    if (!proxyUrl || !fileId) return '';
    const params = new URLSearchParams();
    if (apiKey) params.set('key', apiKey);
    if (download) params.set('download', 'true');
    if (currentDb) params.set('database', currentDb);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return `${proxyUrl}/files/${encodeURIComponent(fileId)}${qs}`;
  }

  /**
   * Download attachment binary from GridFS
   */
  async function downloadAttachment(fileId, filename) {
    if (!isConnected || !proxyUrl) {
      throw new Error('Not connected to MongoDB proxy');
    }

    let targetFileId = fileId;
    if (!targetFileId && filename) {
      const doc = await findFileByFilename(filename);
      if (doc && (doc._id || doc.fileId)) {
        targetFileId = doc._id || doc.fileId;
      }
    }

    if (!targetFileId) {
      throw new Error(`File ID not found for "${filename}"`);
    }

    const downloadUrl = getFileUrl(targetFileId, false);
    const res = await fetch(downloadUrl, {
      headers: getHeaders(false)
    });

    if (!res.ok) {
      throw new Error(`Failed to download file (HTTP ${res.status})`);
    }

    return await res.blob();
  }

  /**
   * Delete an attachment file from MongoDB GridFS
   */
  async function deleteAttachment(taskId, filename, fileId) {
    if (!isConnected || !proxyUrl) return false;

    return enqueueWrite(async () => {
      try {
        let targetFileId = fileId;
        if (!targetFileId && filename) {
          const doc = await findFileByFilename(filename);
          if (doc && (doc._id || doc.fileId)) {
            targetFileId = doc._id || doc.fileId;
          }
        }

        if (targetFileId) {
          const params = new URLSearchParams();
          if (currentDb) params.set('database', currentDb);
          const qs = params.toString() ? `?${params.toString()}` : '';
          const url = `${proxyUrl}/files/${encodeURIComponent(targetFileId)}${qs}`;

          const res = await fetch(url, {
            method: 'DELETE',
            headers: getHeaders(false)
          });
          return res.ok;
        }
        return true;
      } catch (err) {
        console.warn(`[MongoSync] Could not delete attachment "${filename}":`, err);
        return false;
      }
    });
  }

  // Backward compatibility helpers
  function apiUrl(path) {
    const base = proxyUrl || '';
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return base ? `${base}${cleanPath}` : cleanPath;
  }

  function getApiBaseUrl() {
    return proxyUrl;
  }

  function isServedByBackend() {
    return false;
  }

  function setCurrentDb(dbName) {
    if (!dbName) return;
    currentDb = String(dbName).trim();
    notifyChange();
  }

  async function fetchProjects(projectIds) {
    if (!isConnected) return [];
    if (Array.isArray(projectIds) && projectIds.length === 0) {
      return [];
    }
    try {
      const filter = Array.isArray(projectIds) && projectIds.length > 0
        ? { _id: { $in: projectIds } }
        : {};
      const res = await action('find', 'projects', { filter, database: DEFAULT_DB });
      const docs = (res && Array.isArray(res.documents)) ? res.documents : [];
      const list = docs.map(p => ({
        id: p.id || p._id,
        name: p.name || p.id || p._id,
        dbName: p.dbName || p.id || p._id,
        description: p.description || ''
      }));
      if ((!projectIds || projectIds.includes('project-ludum')) && !list.some(p => p.id === 'project-ludum')) {
        list.unshift({
          id: 'project-ludum',
          name: 'Project Ludum',
          dbName: 'vg-task-manager',
          description: 'Default primary project'
        });
      }
      return list;
    } catch (err) {
      console.warn('[MongoSync] Error fetching projects:', err.message);
      if (Array.isArray(projectIds) && !projectIds.includes('project-ludum')) {
        return [];
      }
      return [{
        id: 'project-ludum',
        name: 'Project Ludum',
        dbName: 'vg-task-manager',
        description: 'Default primary project'
      }];
    }
  }

  async function fetchProjectTaskTypes(targetDb = currentDb) {
    if (!isConnected) return [];
    try {
      const res = await action('find', 'task_types', {
        filter: {},
        sort: { name: 1 },
        database: targetDb || currentDb
      });
      const docs = (res && Array.isArray(res.documents)) ? res.documents : [];
      if (docs.length === 0) {
        return [
          { id: 'task', label: 'Task', icon: 'check square outline', color: 'blue' },
          { id: 'bug', label: 'Bug', icon: 'bug', color: 'red' },
          { id: 'analysis', label: 'Analysis', icon: 'search', color: 'teal' },
          { id: 'feature', label: 'Feature', icon: 'star', color: 'green' }
        ];
      }
      return docs.map(t => ({
        id: t.id || t._id,
        label: t.name || t.label || t.id,
        icon: t.icon || 'check square outline',
        color: t.color || 'blue'
      }));
    } catch (err) {
      console.warn('[MongoSync] Error fetching task types:', err.message);
      return [
        { id: 'task', label: 'Task', icon: 'check square outline', color: 'blue' },
        { id: 'bug', label: 'Bug', icon: 'bug', color: 'red' },
        { id: 'analysis', label: 'Analysis', icon: 'search', color: 'teal' },
        { id: 'feature', label: 'Feature', icon: 'star', color: 'green' }
      ];
    }
  }

  window.VG.MongoSync = {
    DEFAULT_URI,
    DEFAULT_DB,
    DEFAULT_PROXY_URL,
    apiUrl,
    getApiBaseUrl,
    isServedByBackend,
    isConnected: () => isConnected,
    getCurrentDb: () => currentDb,
    setCurrentDb,
    fetchProjects,
    fetchProjectTaskTypes,
    getProxyUrl: () => proxyUrl,
    getApiKey: () => apiKey,
    getMaskedUri: () => (proxyUrl ? `${proxyUrl} (${currentDb})` : ''),
    getTaskCount: () => taskCount,
    getStoredConfig,
    setStoredConfig,
    getStoredUri: () => mongoUri,
    setStoredUri: (uri) => setStoredConfig({ mongoUri: uri }),
    checkStatus,
    connect,
    disconnect,
    action,
    loadTasks,
    saveTasks,
    deleteTask,
    uploadAttachment,
    downloadAttachment,
    deleteAttachment,
    getFileUrl,
    onConnectionChange
  };
})();
