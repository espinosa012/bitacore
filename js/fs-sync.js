/**
 * vg-task-manager: Local File System Synchronization ("sincronia")
 * Selects a local directory with tasks.json and attachments/<taskId>/<filename>
 * and provides continuous 2-way sync using the File System Access API.
 */
(function() {
  window.VG = window.VG || {};
  const Storage = window.VG.Storage;
  const Validation = window.VG.Validation;

  let activeDirHandle = null;

  function isLinked() {
    return activeDirHandle !== null;
  }

  function getLinkedDirName() {
    return activeDirHandle ? activeDirHandle.name : null;
  }

  function unlink() {
    activeDirHandle = null;
  }

  /**
   * Opens the native directory picker, reads tasks.json and all attachments
   */
  async function selectDirectory() {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('Your browser does not support the File System Access API (showDirectoryPicker). You can still upload tasks.json or tasks.zip.');
    }

    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });

    // Request write permission if not already granted
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') {
        throw new Error('Write permission to the selected folder was denied.');
      }
    }

    // 1. Read tasks.json
    let tasksFileHandle;
    try {
      tasksFileHandle = await dirHandle.getFileHandle('tasks.json');
    } catch (err) {
      throw new Error(`The folder "${dirHandle.name}" does not contain a "tasks.json" file at its root.`);
    }

    const tasksFile = await tasksFileHandle.getFile();
    const tasksText = await tasksFile.text();

    let parsed;
    try {
      parsed = JSON.parse(tasksText);
    } catch (err) {
      throw new Error(`The "tasks.json" file in "${dirHandle.name}" contains invalid JSON: ${err.message}`);
    }

    const validation = Validation.validateTasksJson(parsed);
    if (!validation.valid) {
      throw new Error(`Format error in "${dirHandle.name}/tasks.json": ${validation.error}`);
    }

    const tasks = Validation.normalizeTasks(validation.list);
    const tasksMap = new Map(tasks.map(t => [t.id, t]));

    // 2. Read attachments/ folder if present
    let attachmentsDirHandle = null;
    try {
      attachmentsDirHandle = await dirHandle.getDirectoryHandle('attachments', { create: false });
    } catch (e) {
      // attachments folder does not exist yet; that is fine
    }

    let loadedAttachmentsCount = 0;
    if (attachmentsDirHandle) {
      try {
        // Iterate over subdirectories in attachments/
        for await (const [taskId, entry] of attachmentsDirHandle.entries()) {
          if (entry.kind === 'directory') {
            const task = tasksMap.get(taskId);
            if (task) {
              task.attachments = task.attachments || [];
              const taskDirHandle = entry;

              for await (const [filename, fileEntry] of taskDirHandle.entries()) {
                if (fileEntry.kind === 'file') {
                  try {
                    const file = await fileEntry.getFile();
                    await Storage.saveAttachmentBlob(taskId, filename, file);
                    loadedAttachmentsCount++;

                    // Register attachment in task metadata if not already present
                    let att = task.attachments.find(a => a.filename === filename);
                    if (!att) {
                      task.attachments.push({
                        id: `att-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                        filename,
                        name: filename,
                        description: '',
                        size: file.size,
                        type: file.type || 'application/octet-stream',
                        created_at: new Date().toISOString()
                      });
                    } else if (!att.size) {
                      att.size = file.size;
                    }
                  } catch (err) {
                    console.warn(`Could not read file ${filename} in task ${taskId}:`, err);
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error reading attachments directory:', err);
      }
    }

    activeDirHandle = dirHandle;

    return {
      tasks,
      dirName: dirHandle.name,
      attachmentCount: loadedAttachmentsCount
    };
  }

  /**
   * Save current tasks to tasks.json in the connected directory
   */
  async function saveTasksToDirectory(tasks) {
    if (!activeDirHandle) return false;
    const currentTasks = tasks || (window.VG.App ? window.VG.App.getTasks() : []);

    try {
      const fileHandle = await activeDirHandle.getFileHandle('tasks.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(currentTasks, null, 2));
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
  async function writeAttachmentFile(taskId, filename, fileOrBlob) {
    if (!activeDirHandle) return false;

    try {
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
  async function deleteAttachmentFile(taskId, filename) {
    if (!activeDirHandle) return false;

    try {
      const attachmentsDir = await activeDirHandle.getDirectoryHandle('attachments', { create: false }).catch(() => null);
      if (!attachmentsDir) return false;

      const taskDir = await attachmentsDir.getDirectoryHandle(taskId, { create: false }).catch(() => null);
      if (!taskDir) return false;

      await taskDir.removeEntry(filename);
      return true;
    } catch (err) {
      console.warn(`Could not delete attachment "${filename}" for task ${taskId} from disk:`, err);
      return false;
    }
  }

  window.VG.FsSync = {
    isLinked,
    getLinkedDirName,
    unlink,
    selectDirectory,
    saveTasksToDirectory,
    writeAttachmentFile,
    deleteAttachmentFile
  };
})();
