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
  const DEFAULT_PROJECT_ID = 'project-ludum';
  const DEFAULT_TASK_TYPES = [
    { id: 'task', name: 'Task', icon: 'check square outline', color: 'blue' },
    { id: 'bug', name: 'Bug', icon: 'bug', color: 'red' },
    { id: 'analysis', name: 'Analysis', icon: 'search', color: 'teal' },
    { id: 'feature', name: 'Feature', icon: 'star', color: 'green' }
  ];

  let isConnected = false;
  let proxyUrl = '';
  let apiKey = '';
  let currentDb = DEFAULT_DB;
  // All projects share one database; every task carries a `project` field
  let currentProject = null;
  let migrationPromise = null;
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

  /** Id of the per-project tag registry document in the shared `tags` collection */
  function tagRegistryId(projectId) {
    return `registry:${projectId}`;
  }

  /** Id of a per-project task type document in the shared `task_types` collection */
  function taskTypeDocId(projectId, typeId) {
    return `${projectId}:${typeId}`;
  }

  function requireProject(projectId) {
    const pid = projectId || currentProject;
    if (!pid) throw new Error('No active project selected.');
    return pid;
  }

  function notifyChange() {
    const state = {
      isConnected,
      proxyUrl,
      currentDb,
      currentProject,
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
      migrationPromise = null;
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
    currentProject = null;
    migrationPromise = null;
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

    const projectId = requireProject();

    // 1. Find all tasks of the active project
    const tasksRes = await action('find', 'tasks', {
      filter: { project: projectId },
      sort: { board_order: 1, updated_at: -1 },
      limit: 5000
    });
    const rawTasks = (tasksRes && Array.isArray(tasksRes.documents)) ? tasksRes.documents : [];

    const normalized = rawTasks.map(t => {
      const id = t.id || t._id;
      const copy = { ...t, id: String(id) };
      return copy;
    });
    taskCount = normalized.length;

    // 2. Find the project's tag registry
    let tags = [];
    try {
      const tagDocRes = await action('findOne', 'tags', {
        filter: { _id: tagRegistryId(projectId) }
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
    // Captured now so a project switch while the write is queued cannot
    // save this board into the newly selected project
    const projectId = currentProject;
    if (!projectId) return false;
    const payload = doc || window.VG.App.buildDocument();
    const tasksList = payload && Array.isArray(payload.tasks) ? payload.tasks.slice() : (Array.isArray(payload) ? payload.slice() : []);
    const tagsList = payload && Array.isArray(payload.tags) ? payload.tags.slice() : [];

    return enqueueWrite(async () => {
      try {

        // 1. Save the project's tags registry
        if (tagsList.length > 0 || (payload && payload.tags)) {
          await action('updateOne', 'tags', {
            filter: { _id: tagRegistryId(projectId) },
            update: {
              $set: {
                project: projectId,
                tags: tagsList,
                updatedAt: { '$date': new Date().toISOString() }
              }
            },
            upsert: true
          });
        }

        // 2. Upsert tasks in batches. Filtering by project means a task id
        // owned by another project fails instead of being overwritten.
        const BATCH_SIZE = 8;
        for (let i = 0; i < tasksList.length; i += BATCH_SIZE) {
          const chunk = tasksList.slice(i, i + BATCH_SIZE);
          await Promise.all(chunk.map(t => {
            const id = t.id || t._id;
            const docToSave = { ...t, _id: id, id, project: projectId };
            return action('updateOne', 'tasks', {
              filter: { _id: id, project: projectId },
              update: { $set: docToSave },
              upsert: true
            });
          }));
        }

        // 3. Remove this project's deleted tasks from collection
        const currentIds = tasksList.map(t => t.id || t._id);
        if (currentIds.length > 0) {
          await action('deleteMany', 'tasks', {
            filter: { project: projectId, _id: { $nin: currentIds } }
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
    if (!isConnected || !currentProject) return false;
    const projectId = currentProject;
    return enqueueWrite(async () => {
      try {
        await action('deleteOne', 'tasks', {
          filter: { _id: taskId, project: projectId }
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
  async function findFileByFilename(filename, database) {
    try {
      const res = await action('findOne', 'fs.files', {
        filter: { filename: filename },
        ...(database ? { database } : {})
      });
      return res && res.document ? res.document : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Build direct URL for downloading or viewing a GridFS file
   */
  function getFileUrl(fileId, download = false, database = null) {
    if (!proxyUrl || !fileId) return '';
    const params = new URLSearchParams();
    if (apiKey) params.set('key', apiKey);
    if (download) params.set('download', 'true');
    // `database` is only set on files uploaded before projects shared one database
    const targetDb = database || currentDb;
    if (targetDb) params.set('database', targetDb);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return `${proxyUrl}/files/${encodeURIComponent(fileId)}${qs}`;
  }

  /**
   * Download attachment binary from GridFS
   */
  async function downloadAttachment(fileId, filename, database = null) {
    if (!isConnected || !proxyUrl) {
      throw new Error('Not connected to MongoDB proxy');
    }

    let targetFileId = fileId;
    if (!targetFileId && filename) {
      const doc = await findFileByFilename(filename, database);
      if (doc && (doc._id || doc.fileId)) {
        targetFileId = doc._id || doc.fileId;
      }
    }

    if (!targetFileId) {
      throw new Error(`File ID not found for "${filename}"`);
    }

    const downloadUrl = getFileUrl(targetFileId, false, database);
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
  async function deleteAttachment(taskId, filename, fileId, database = null) {
    if (!isConnected || !proxyUrl) return false;

    return enqueueWrite(async () => {
      try {
        let targetFileId = fileId;
        if (!targetFileId && filename) {
          const doc = await findFileByFilename(filename, database);
          if (doc && (doc._id || doc.fileId)) {
            targetFileId = doc._id || doc.fileId;
          }
        }

        if (targetFileId) {
          const params = new URLSearchParams();
          const targetDb = database || currentDb;
          if (targetDb) params.set('database', targetDb);
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

  function setCurrentProject(projectId) {
    currentProject = projectId ? String(projectId).trim() : null;
    notifyChange();
  }

  function normalizeProject(p) {
    const id = p.id || p._id;
    const format = p['task-id-format'] || p.taskIdFormat || (id === DEFAULT_PROJECT_ID ? 'lud-' : `${id}-`);
    return {
      id,
      name: p.name || id,
      description: p.description || '',
      'task-id-format': format,
      taskIdFormat: format,
      createdAt: p.createdAt || null
    };
  }

  const DEFAULT_PROJECT_DOC = {
    id: DEFAULT_PROJECT_ID,
    name: 'Project Ludum',
    description: 'Default primary project',
    'task-id-format': 'lud-',
    taskIdFormat: 'lud-'
  };

  /**
   * One-off migration from the previous layout (one database per project,
   * unscoped task types and tag registry) to a single shared database where
   * every document carries a `project` field. Safe to run repeatedly.
   */
  async function migrateToSharedDb() {
    // 1. Tasks created before projects existed belong to the default project
    await action('updateMany', 'tasks', {
      filter: { project: { $exists: false } },
      update: { $set: { project: DEFAULT_PROJECT_ID } }
    });

    // 2. Legacy unscoped tag registry -> default project's registry
    const legacyTags = await action('findOne', 'tags', { filter: { _id: 'registry' } });
    if (legacyTags && legacyTags.document) {
      await action('updateOne', 'tags', {
        filter: { _id: tagRegistryId(DEFAULT_PROJECT_ID) },
        update: {
          $setOnInsert: {
            project: DEFAULT_PROJECT_ID,
            tags: Array.isArray(legacyTags.document.tags) ? legacyTags.document.tags : []
          }
        },
        upsert: true
      });
      await action('deleteOne', 'tags', { filter: { _id: 'registry' } });
    }

    // 3. Legacy unscoped task types -> default project's task types
    const legacyTypes = await action('find', 'task_types', { filter: { project: { $exists: false } } });
    const legacyTypeDocs = (legacyTypes && Array.isArray(legacyTypes.documents)) ? legacyTypes.documents : [];
    for (const t of legacyTypeDocs) {
      await upsertTaskTypeDoc(DEFAULT_PROJECT_ID, t, '$setOnInsert');
    }
    if (legacyTypeDocs.length > 0) {
      await action('deleteMany', 'task_types', { filter: { project: { $exists: false } } });
    }

    // 4. Copy data out of the old per-project databases
    const projRes = await action('find', 'projects', { filter: { dbName: { $exists: true } } });
    const projDocs = (projRes && Array.isArray(projRes.documents)) ? projRes.documents : [];
    for (const p of projDocs) {
      const pid = p.id || p._id;
      const oldDb = String(p.dbName || '').trim();
      if (oldDb && oldDb !== currentDb) {
        await copyProjectDatabase(pid, oldDb);
      }
      await action('updateOne', 'projects', {
        filter: { _id: p._id },
        update: {
          $set: { migratedFromDb: oldDb || null },
          $unset: { dbName: '' }
        }
      });
    }
  }

  async function copyProjectDatabase(projectId, oldDb) {
    const tasksRes = await action('find', 'tasks', { filter: {}, limit: 5000, database: oldDb });
    const oldTasks = (tasksRes && Array.isArray(tasksRes.documents)) ? tasksRes.documents : [];
    for (const t of oldTasks) {
      const id = String(t.id || t._id);
      // Attachments stay in the old database's GridFS; remember where to find them
      const attachments = Array.isArray(t.attachments)
        ? t.attachments.map(a => (a && !a.database ? { ...a, database: oldDb } : a))
        : [];
      try {
        await action('updateOne', 'tasks', {
          filter: { _id: id, project: projectId },
          update: { $set: { ...t, _id: id, id, project: projectId, attachments } },
          upsert: true
        });
      } catch (err) {
        console.warn(`[MongoSync] Could not migrate task ${id} from "${oldDb}":`, err.message);
      }
    }

    const typesRes = await action('find', 'task_types', { filter: {}, database: oldDb });
    const oldTypes = (typesRes && Array.isArray(typesRes.documents)) ? typesRes.documents : [];
    for (const t of oldTypes) {
      await upsertTaskTypeDoc(projectId, t, '$setOnInsert');
    }

    const tagsRes = await action('findOne', 'tags', { filter: { _id: 'registry' }, database: oldDb });
    if (tagsRes && tagsRes.document && Array.isArray(tagsRes.document.tags)) {
      await action('updateOne', 'tags', {
        filter: { _id: tagRegistryId(projectId) },
        update: { $setOnInsert: { project: projectId, tags: tagsRes.document.tags } },
        upsert: true
      });
    }
  }

  function ensureMigrated() {
    if (!migrationPromise) {
      migrationPromise = migrateToSharedDb().catch(err => {
        console.warn('[MongoSync] Shared database migration failed:', err.message);
        migrationPromise = null;
      });
    }
    return migrationPromise;
  }

  async function fetchProjects(projectIds) {
    if (!isConnected) return [];
    if (Array.isArray(projectIds) && projectIds.length === 0) {
      return [];
    }
    await ensureMigrated();
    const isAll = !projectIds || (Array.isArray(projectIds) && projectIds.includes('*'));
    const wantsDefault = isAll || projectIds.includes(DEFAULT_PROJECT_ID);
    try {
      const filter = isAll ? {} : { _id: { $in: projectIds } };
      const res = await action('find', 'projects', { filter });
      const docs = (res && Array.isArray(res.documents)) ? res.documents : [];
      const list = docs.map(normalizeProject);
      if (wantsDefault && !list.some(p => p.id === DEFAULT_PROJECT_ID)) {
        list.unshift({ ...DEFAULT_PROJECT_DOC });
      }
      return list;
    } catch (err) {
      console.warn('[MongoSync] Error fetching projects:', err.message);
      return wantsDefault ? [{ ...DEFAULT_PROJECT_DOC }] : [];
    }
  }

  async function createProject({ id, name, description }) {
    if (!isConnected) throw new Error('Not connected to MongoDB');
    const cleanId = (id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const cleanName = (name || cleanId).trim();
    const cleanDesc = (description || '').trim();

    if (!cleanId || cleanId.length < 2) {
      throw new Error('Project ID is required (min 2 alphanumeric/hyphen characters).');
    }
    if (!cleanName) {
      throw new Error('Project display name is required.');
    }

    const existing = await action('findOne', 'projects', {
      filter: { $or: [{ _id: cleanId }, { id: cleanId }] }
    });
    if (existing && existing.document) {
      throw new Error(`Project "${cleanId}" already exists.`);
    }

    const format = `${cleanId}-`;
    const doc = {
      _id: cleanId,
      id: cleanId,
      name: cleanName,
      description: cleanDesc,
      'task-id-format': format,
      taskIdFormat: format,
      createdAt: { '$date': new Date().toISOString() }
    };
    await action('insertOne', 'projects', { document: doc });

    try {
      await seedProjectDefaults(cleanId);
    } catch (e) {
      console.warn('[MongoSync] Note on seeding project defaults:', e.message);
    }
    return doc;
  }

  async function seedProjectDefaults(projectId) {
    for (const t of DEFAULT_TASK_TYPES) {
      await upsertTaskTypeDoc(projectId, t, '$setOnInsert');
    }
    await action('updateOne', 'tags', {
      filter: { _id: tagRegistryId(projectId) },
      update: { $setOnInsert: { project: projectId, tags: [] } },
      upsert: true
    });
  }

  async function upsertTaskTypeDoc(projectId, t, operator = '$set') {
    const typeId = String(t.id || t._id).replace(/^.*:/, '');
    const doc = {
      id: typeId,
      project: projectId,
      name: t.name || t.label || typeId,
      label: t.name || t.label || typeId,
      icon: t.icon || 'check square outline',
      color: t.color || 'blue'
    };
    await action('updateOne', 'task_types', {
      filter: { _id: taskTypeDocId(projectId, typeId) },
      update: { [operator]: doc },
      upsert: true
    });
    return doc;
  }

  async function fetchProjectTags(projectId = currentProject) {
    if (!isConnected) return [];
    try {
      const pid = requireProject(projectId);
      const tagRes = await action('findOne', 'tags', {
        filter: { _id: tagRegistryId(pid) }
      });
      const tagDoc = tagRes ? tagRes.document : null;
      const rawTags = (tagDoc && Array.isArray(tagDoc.tags)) ? tagDoc.tags : [];

      const tasksRes = await action('find', 'tasks', {
        filter: { project: pid },
        projection: { tags: 1 },
        limit: 5000
      });
      const tasksDocs = (tasksRes && Array.isArray(tasksRes.documents)) ? tasksRes.documents : [];
      const countMap = {};
      tasksDocs.forEach(t => {
        (t.tags || []).forEach(name => {
          const k = String(name).toLowerCase();
          countMap[k] = (countMap[k] || 0) + 1;
        });
      });

      return rawTags.map(t => {
        const name = typeof t === 'string' ? t : t.name;
        const color = (t && typeof t === 'object' && t.color) ? t.color : 'grey';
        return {
          name,
          color,
          taskCount: countMap[String(name).toLowerCase()] || 0
        };
      });
    } catch (err) {
      console.warn('[MongoSync] Error fetching project tags:', err.message);
      return [];
    }
  }

  async function readTagRegistry(pid) {
    const tagRes = await action('findOne', 'tags', {
      filter: { _id: tagRegistryId(pid) }
    });
    const tagDoc = tagRes ? tagRes.document : null;
    return (tagDoc && Array.isArray(tagDoc.tags)) ? tagDoc.tags : [];
  }

  async function writeTagRegistry(pid, tags) {
    await action('updateOne', 'tags', {
      filter: { _id: tagRegistryId(pid) },
      update: { $set: { project: pid, tags } },
      upsert: true
    });
  }

  async function addProjectTag(projectId = currentProject, name, color = 'blue') {
    if (!isConnected) throw new Error('Not connected');
    const pid = requireProject(projectId);
    const tagName = (name || '').trim();
    if (!tagName) throw new Error('Tag name is required.');
    const rawTags = await readTagRegistry(pid);
    if (rawTags.some(t => (typeof t === 'string' ? t : t.name).toLowerCase() === tagName.toLowerCase())) {
      throw new Error(`Tag "${tagName}" already exists.`);
    }
    rawTags.push({ name: tagName, color: color || 'blue' });
    await writeTagRegistry(pid, rawTags);
    return { name: tagName, color };
  }

  async function updateProjectTag(projectId = currentProject, oldName, newName, color) {
    if (!isConnected) throw new Error('Not connected');
    const pid = requireProject(projectId);
    const cleanOld = (oldName || '').trim();
    const cleanNew = (newName || '').trim();
    if (!cleanOld || !cleanNew) throw new Error('Old and new tag names are required.');

    // 1. Cascade update the project's tasks
    await action('updateMany', 'tasks', {
      filter: { project: pid, tags: cleanOld },
      update: { $set: { "tags.$[elem]": cleanNew } },
      arrayFilters: [{ "elem": cleanOld }]
    });

    // 2. Update registry
    let rawTags = await readTagRegistry(pid);
    rawTags = rawTags.map(t => {
      const curName = typeof t === 'string' ? t : t.name;
      if (curName.toLowerCase() === cleanOld.toLowerCase()) {
        return { name: cleanNew, color: color || (typeof t === 'object' && t.color ? t.color : 'blue') };
      }
      return typeof t === 'string' ? { name: t, color: 'grey' } : t;
    });
    await writeTagRegistry(pid, rawTags);
    return true;
  }

  async function deleteProjectTag(projectId = currentProject, tagName) {
    if (!isConnected) throw new Error('Not connected');
    const pid = requireProject(projectId);
    const cleanName = (tagName || '').trim();
    if (!cleanName) throw new Error('Tag name is required.');

    // 1. Cascade pull from the project's tasks
    await action('updateMany', 'tasks', {
      filter: { project: pid, tags: cleanName },
      update: { $pull: { tags: cleanName } }
    });

    // 2. Remove from registry
    let rawTags = await readTagRegistry(pid);
    rawTags = rawTags.filter(t => {
      const curName = typeof t === 'string' ? t : t.name;
      return curName.toLowerCase() !== cleanName.toLowerCase();
    });
    await writeTagRegistry(pid, rawTags);
    return true;
  }

  async function saveProjectTaskType(projectId = currentProject, { id, name, icon, color }) {
    if (!isConnected) throw new Error('Not connected');
    const pid = requireProject(projectId);
    const cleanId = (id || name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const cleanName = (name || cleanId).trim();
    if (!cleanId || !cleanName) throw new Error('Task type ID and name are required.');

    return upsertTaskTypeDoc(pid, {
      id: cleanId,
      name: cleanName,
      icon: (icon || 'check square outline').trim(),
      color: (color || 'blue').trim()
    });
  }

  async function deleteProjectTaskType(projectId = currentProject, typeId) {
    if (!isConnected) throw new Error('Not connected');
    const pid = requireProject(projectId);
    if (typeId === 'task') throw new Error('The default "task" type cannot be deleted.');

    // Reassign the project's tasks with this type to 'task'
    await action('updateMany', 'tasks', {
      filter: { project: pid, type: typeId },
      update: { $set: { type: 'task' } }
    });
    await action('deleteOne', 'task_types', {
      filter: { _id: taskTypeDocId(pid, typeId) }
    });
    return true;
  }

  function defaultTaskTypeList() {
    return DEFAULT_TASK_TYPES.map(t => ({ id: t.id, label: t.name, icon: t.icon, color: t.color }));
  }

  async function fetchProjectTaskTypes(projectId = currentProject) {
    if (!isConnected) return [];
    try {
      const pid = requireProject(projectId);
      const res = await action('find', 'task_types', {
        filter: { project: pid },
        sort: { name: 1 }
      });
      const docs = (res && Array.isArray(res.documents)) ? res.documents : [];
      if (docs.length === 0) {
        return defaultTaskTypeList();
      }
      return docs.map(t => ({
        id: t.id || String(t._id).replace(/^.*:/, ''),
        label: t.name || t.label || t.id,
        icon: t.icon || 'check square outline',
        color: t.color || 'blue'
      }));
    } catch (err) {
      console.warn('[MongoSync] Error fetching task types:', err.message);
      return defaultTaskTypeList();
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
    DEFAULT_PROJECT_ID,
    getCurrentDb: () => currentDb,
    getCurrentProject: () => currentProject,
    setCurrentProject,
    fetchProjects,
    createProject,
    fetchProjectTaskTypes,
    saveProjectTaskType,
    deleteProjectTaskType,
    fetchProjectTags,
    addProjectTag,
    updateProjectTag,
    deleteProjectTag,
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
