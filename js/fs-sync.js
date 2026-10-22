/**
 * bitacore: Local File System Synchronization ("sincronia")
 * Links a local directory with tasks.json and attachments/<taskId>/<filename>.
 *
 * Three backends, chosen automatically:
 *  - 'native':   File System Access API (Chrome/Edge). Live 2-way sync with any folder.
 *  - 'agent':    Local helper (`node server.js <folder>`). Live 2-way sync in any browser
 *                (Safari, Firefox...). Used when the agent is reachable.
 *  - 'snapshot': <input webkitdirectory> fallback. Reads the folder once; changes are
 *                not written back (use Download ZIP to save them).
 */
(function() {
  window.VG = window.VG || {};
  const Storage = window.VG.Storage;
  const Validation = window.VG.Validation;

  const AGENT_DEFAULT_URL = 'http://localhost:8766';
  const AGENT_URL_KEY = 'vg-agent-url';

  let mode = null;            // 'native' | 'agent' | 'snapshot' | null
  let linkedDirName = null;
  let activeDirHandle = null; // native only
  let agentUrl = null;        // agent only
  let agentStatus = null;     // last successful probe (cached so the click stays synchronous)

  // Writes are chained so two saves never interleave on the same file
  // (createWritable / PUT requests could otherwise land out of order).
  let writeQueue = Promise.resolve();
  function enqueueWrite(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
  }

  function isLinked() {
    return mode !== null;
  }

  /** True when edits are written back to disk automatically */
  function isLiveSync() {
    return mode === 'native' || mode === 'agent';
  }

  function getMode() {
    return mode;
  }

  function getLinkedDirName() {
    return linkedDirName;
  }

  function unlink() {
    mode = null;
    linkedDirName = null;
    activeDirHandle = null;
    agentUrl = null;
  }

  function supportsNativePicker() {
    return 'showDirectoryPicker' in window;
  }

  function isServedByAgent() {
    const host = window.location.hostname;
    return window.location.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
  }

  function getAgentBaseUrl() {
    if (isServedByAgent()) return window.location.origin;
    let stored = null;
    try { stored = localStorage.getItem(AGENT_URL_KEY); } catch (e) { /* ignore */ }
    return (stored || AGENT_DEFAULT_URL).replace(/\/+$/, '');
  }

  /** Returns agent status or null if the local agent is not reachable */
  async function probeAgent(timeoutMs = 1500) {
    const base = getAgentBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/api/status`, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) { agentStatus = null; return null; }
      const data = await res.json();
      agentStatus = data && data.app === 'bitacore' ? { ...data, base } : null;
    } catch (e) {
      agentStatus = null;
    } finally {
      clearTimeout(timer);
    }
    return agentStatus;
  }

  function getAgentStatus() {
    return agentStatus;
  }

  /**
   * Shared loader: parses tasks.json text and imports attachment files.
   * @param {string} dirName
   * @param {string} tasksText
   * @param {Array<{taskId: string, filename: string, getFile: () => Promise<Blob>}>} attachmentEntries
   */
  async function loadFolderContents(dirName, tasksText, attachmentEntries) {
    let parsed;
    try {
      parsed = JSON.parse(tasksText);
    } catch (err) {
      throw new Error(`The "tasks.json" file in "${dirName}" contains invalid JSON: ${err.message}`);
    }

    const validation = Validation.validateTasksJson(parsed);
    if (!validation.valid) {
      throw new Error(`Format error in "${dirName}/tasks.json": ${validation.error}`);
    }

    const tasks = Validation.normalizeTasks(validation.list);
    const tasksMap = new Map(tasks.map(t => [t.id, t]));

    const files = [];
    for (const entry of attachmentEntries) {
      if (!tasksMap.has(entry.taskId)) continue;
      try {
        files.push({ entry, file: await entry.getFile() });
      } catch (err) {
        console.warn(`Could not read file ${entry.filename} in task ${entry.taskId}:`, err);
      }
    }

    // The folder replaces the board: drop blobs of the previous one
    await Storage.clearAttachmentsIfSoleTab();

    let loadedAttachmentsCount = 0;
    for (const { entry, file } of files) {
      const task = tasksMap.get(entry.taskId);
      await Storage.saveAttachmentBlob(entry.taskId, entry.filename, file);
      loadedAttachmentsCount++;

      // Register attachment in task metadata if not already present
      const att = task.attachments.find(a => a.filename === entry.filename);
      if (!att) {
        task.attachments.push({
          id: window.VG.Constants.generateId('att'),
          filename: entry.filename,
          name: entry.filename,
          description: '',
          size: file.size,
          type: file.type || 'application/octet-stream',
          created_at: new Date().toISOString()
        });
      } else if (!att.size) {
        att.size = file.size;
      }
    }

    return { tasks, tags: validation.tags, dirName, attachmentCount: loadedAttachmentsCount };
  }

  // ---------------------------------------------------------------------------
  // Backend: native (File System Access API)
  // ---------------------------------------------------------------------------

  async function selectNativeDirectory() {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

    // Request write permission if not already granted
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') {
        throw new Error('Write permission to the selected folder was denied.');
      }
    }

    let tasksFileHandle;
    try {
      tasksFileHandle = await dirHandle.getFileHandle('tasks.json');
    } catch (err) {
      throw new Error(`The folder "${dirHandle.name}" does not contain a "tasks.json" file at its root.`);
    }
    const tasksText = await (await tasksFileHandle.getFile()).text();

    const entries = [];
    try {
      const attachmentsDirHandle = await dirHandle.getDirectoryHandle('attachments', { create: false });
      for await (const [taskId, taskEntry] of attachmentsDirHandle.entries()) {
        if (taskEntry.kind !== 'directory') continue;
        for await (const [filename, fileEntry] of taskEntry.entries()) {
          if (fileEntry.kind === 'file') {
            entries.push({ taskId, filename, getFile: () => fileEntry.getFile() });
          }
        }
      }
    } catch (e) {
      // attachments folder does not exist yet; that is fine
    }

    const result = await loadFolderContents(dirHandle.name, tasksText, entries);
    mode = 'native';
    activeDirHandle = dirHandle;
    linkedDirName = dirHandle.name;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Backend: agent (local server.js)
  // ---------------------------------------------------------------------------

  async function connectAgent(status) {
    const base = status.base;
    const dirName = status.dirName;

    const tasksRes = await fetch(`${base}/api/tasks`, { cache: 'no-store' });
    if (tasksRes.status === 404) {
      throw new Error(`The sync folder "${status.dirPath}" does not contain a "tasks.json" file.\n\nCreate one (e.g. with "Download JSON") or restart the agent pointing to another folder:\n  node server.js /path/to/folder`);
    }
    if (!tasksRes.ok) throw new Error(`Local agent error reading tasks.json (HTTP ${tasksRes.status}).`);
    const tasksText = await tasksRes.text();

    const listRes = await fetch(`${base}/api/attachments`, { cache: 'no-store' });
    const list = listRes.ok ? await listRes.json() : [];
    const entries = list.map(item => ({
      taskId: item.taskId,
      filename: item.filename,
      getFile: async () => {
        const res = await fetch(attachmentUrl(base, item.taskId, item.filename), { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        return new File([blob], item.filename, { type: blob.type });
      }
    }));

    const result = await loadFolderContents(dirName, tasksText, entries);
    mode = 'agent';
    agentUrl = base;
    linkedDirName = dirName;
    return result;
  }

  function attachmentUrl(base, taskId, filename) {
    return `${base}/api/attachments/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`;
  }

  // ---------------------------------------------------------------------------
  // Backend: snapshot (<input webkitdirectory>, read-only)
  // ---------------------------------------------------------------------------

  function pickDirectoryFiles() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);

      const cleanup = () => input.remove();
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        cleanup();
        resolve(files);
      });
      input.addEventListener('cancel', () => {
        cleanup();
        reject(new DOMException('Folder selection cancelled', 'AbortError'));
      });
      input.click();
    });
  }

  async function selectSnapshotDirectory() {
    const files = await pickDirectoryFiles();
    if (files.length === 0) {
      throw new DOMException('Folder selection cancelled', 'AbortError');
    }

    // webkitRelativePath = "<dir>/tasks.json", "<dir>/attachments/<taskId>/<file>"
    const dirName = files[0].webkitRelativePath.split('/')[0] || 'folder';
    let tasksFile = null;
    const entries = [];
    for (const file of files) {
      const parts = file.webkitRelativePath.split('/').slice(1);
      if (parts.length === 1 && parts[0] === 'tasks.json') {
        tasksFile = file;
      } else if (parts.length === 3 && parts[0] === 'attachments' && !parts[2].startsWith('.')) {
        entries.push({ taskId: parts[1], filename: parts[2], getFile: async () => file });
      }
    }

    if (!tasksFile) {
      throw new Error(`The folder "${dirName}" does not contain a "tasks.json" file at its root.`);
    }

    const result = await loadFolderContents(dirName, await tasksFile.text(), entries);
    mode = 'snapshot';
    linkedDirName = dirName;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Links a folder using the best available backend.
   * Result includes `mode` so the UI can explain read-only snapshots.
   */
  async function selectDirectory() {
    // Pickers must open synchronously inside the click (Safari is strict about
    // user activation), so the agent is probed beforehand and cached.
    let result;
    if (agentStatus && (isServedByAgent() || !supportsNativePicker())) {
      result = await connectAgent(agentStatus);
    } else if (supportsNativePicker()) {
      result = await selectNativeDirectory();
    } else {
      probeAgent(); // refresh in background in case the agent was started later
      result = await selectSnapshotDirectory();
    }
    return { ...result, mode };
  }

  /**
   * Save current tasks to tasks.json in the connected directory
   */
  /** Writes the board document ({ tags, tasks }) to tasks.json */
  async function saveTasksToDirectory(doc) {
    if (!isLiveSync()) return false;
    const json = JSON.stringify(doc || window.VG.App.buildDocument(), null, 2);
    return enqueueWrite(() => writeTasksJson(json));
  }

  async function writeTasksJson(json) {
    if (!isLiveSync()) return false;
    try {
      if (mode === 'agent') {
        const res = await fetch(`${agentUrl}/api/tasks`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: json
        });
        return res.ok;
      }
      const fileHandle = await activeDirHandle.getFileHandle('tasks.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      return true;
    } catch (err) {
      console.warn('Could not write tasks.json to local directory:', err);
      return false;
    }
  }

  /**
   * Write an attachment file to attachments/<taskId>/<filename> on disk
   */
  function writeAttachmentFile(taskId, filename, fileOrBlob) {
    if (!isLiveSync()) return Promise.resolve(false);
    return enqueueWrite(() => writeAttachmentNow(taskId, filename, fileOrBlob));
  }

  async function writeAttachmentNow(taskId, filename, fileOrBlob) {
    if (!isLiveSync()) return false;
    try {
      if (mode === 'agent') {
        const res = await fetch(attachmentUrl(agentUrl, taskId, filename), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: fileOrBlob
        });
        return res.ok;
      }
      const attachmentsDir = await activeDirHandle.getDirectoryHandle('attachments', { create: true });
      const taskDir = await attachmentsDir.getDirectoryHandle(taskId, { create: true });
      const fileHandle = await taskDir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(fileOrBlob);
      await writable.close();
      return true;
    } catch (err) {
      console.warn(`Could not write attachment "${filename}" for task ${taskId} to disk:`, err);
      return false;
    }
  }

  /**
   * Delete an attachment file from attachments/<taskId>/<filename> on disk
   */
  function deleteAttachmentFile(taskId, filename) {
    if (!isLiveSync()) return Promise.resolve(false);
    return enqueueWrite(() => deleteAttachmentNow(taskId, filename));
  }

  async function deleteAttachmentNow(taskId, filename) {
    if (!isLiveSync()) return false;
    try {
      if (mode === 'agent') {
        const res = await fetch(attachmentUrl(agentUrl, taskId, filename), { method: 'DELETE' });
        return res.ok;
      }
      const attachmentsDir = await activeDirHandle.getDirectoryHandle('attachments', { create: false }).catch(() => null);
      if (!attachmentsDir) return false;

      const taskDir = await attachmentsDir.getDirectoryHandle(taskId, { create: false }).catch(() => null);
      if (!taskDir) return false;

      await taskDir.removeEntry(filename);
      // Drop the task folder once it is empty, like the local agent does
      let isEmpty = true;
      for await (const _ of taskDir.keys()) { isEmpty = false; break; }
      if (isEmpty) await attachmentsDir.removeEntry(taskId).catch(() => {});
      return true;
    } catch (err) {
      console.warn(`Could not delete attachment "${filename}" for task ${taskId} from disk:`, err);
      return false;
    }
  }

  window.VG.FsSync = {
    isLinked,
    isLiveSync,
    getMode,
    getLinkedDirName,
    unlink,
    probeAgent,
    getAgentStatus,
    selectDirectory,
    saveTasksToDirectory,
    writeAttachmentFile,
    deleteAttachmentFile
  };
})();
