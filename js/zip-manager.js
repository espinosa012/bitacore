/**
 * bitacore: ZIP Export & Import Manager
 * Packages tasks.json at root and task attachments under attachments/<taskId>/<filename>
 */
(function() {
  window.VG = window.VG || {};
  const Storage = window.VG.Storage;
  const Validation = window.VG.Validation;

  async function exportTasksZip(tasks, zipFilename = 'tasks.zip') {
    if (!window.JSZip) {
      throw new Error('JSZip library is not loaded. Cannot create zip archive.');
    }

    if (!tasks || tasks.length === 0) {
      throw new Error('Board is empty. Create a task or upload files first.');
    }

    const zip = new JSZip();

    // 1. Add tasks.json at root
    const jsonStr = JSON.stringify(window.VG.App.buildDocument(), null, 2);
    zip.file('tasks.json', jsonStr);

    // 2. Add attachments in subdirectories: attachments/<taskId>/<filename>
    let attachmentCount = 0;
    for (const task of tasks) {
      if (task.attachments && task.attachments.length > 0) {
        for (const att of task.attachments) {
          try {
            const blob = await Storage.getAttachmentBlob(task.id, att.filename);
            if (blob) {
              const zipPath = `attachments/${task.id}/${att.filename}`;
              zip.file(zipPath, blob);
              attachmentCount++;
            }
          } catch (err) {
            console.warn(`Could not include attachment "${att.filename}" for task ${task.id} in zip:`, err);
          }
        }
      }
    }

    // 3. Generate the ZIP blob
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // 4. Trigger download
    const downloadUrl = URL.createObjectURL(zipBlob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = zipFilename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);

    return { taskCount: tasks.length, attachmentCount };
  }

  async function importTasksZip(file) {
    if (!window.JSZip) {
      throw new Error('JSZip library is not loaded.');
    }

    const zip = await JSZip.loadAsync(file);

    // 1. Find tasks.json (check root or any top-level json file)
    let tasksJsonEntry = zip.file('tasks.json');
    if (!tasksJsonEntry) {
      // Search for any .json file at root
      const jsonFiles = Object.keys(zip.files).filter(p => !p.includes('/') && p.toLowerCase().endsWith('.json'));
      if (jsonFiles.length > 0) {
        tasksJsonEntry = zip.file(jsonFiles[0]);
      }
    }

    if (!tasksJsonEntry) {
      throw new Error('The ZIP archive must contain a "tasks.json" file at its root.');
    }

    const tasksJsonText = await tasksJsonEntry.async('text');
    let parsed;
    try {
      parsed = JSON.parse(tasksJsonText);
    } catch (e) {
      throw new Error('Invalid JSON syntax inside tasks.json in ZIP archive: ' + e.message);
    }

    const validation = Validation.validateTasksJson(parsed);
    if (!validation.valid) {
      throw new Error('Format error in tasks.json: ' + validation.error);
    }

    const tasks = Validation.normalizeTasks(validation.list);
    const tasksMap = new Map(tasks.map(t => [t.id, t]));

    // 2. Extract attachments under attachments/<taskId>/<filename>
    const attachmentRegex = /^attachments\/([^\/]+)\/([^\/]+)$/;
    const extracted = [];

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      const match = relativePath.match(attachmentRegex);
      if (!match || !tasksMap.has(match[1])) continue;
      try {
        extracted.push({ taskId: match[1], filename: match[2], blob: await zipEntry.async('blob') });
      } catch (err) {
        console.warn(`Could not extract attachment ${relativePath}:`, err);
      }
    }

    // 3. The archive replaces the board: drop blobs of the previous one only
    //    once everything was read successfully.
    await Storage.clearAttachmentsIfSoleTab();

    let attachmentCount = 0;
    for (const { taskId, filename, blob } of extracted) {
      const task = tasksMap.get(taskId);
      await Storage.saveAttachmentBlob(taskId, filename, blob);
      attachmentCount++;

      // Ensure attachment is recorded in task.attachments
      const att = task.attachments.find(a => a.filename === filename);
      if (!att) {
        task.attachments.push({
          id: window.VG.Constants.generateId('att'),
          filename,
          name: filename,
          description: '',
          size: blob.size,
          type: blob.type || 'application/octet-stream',
          created_at: new Date().toISOString()
        });
      } else if (!att.size) {
        att.size = blob.size;
      }
    }

    return { tasks, tags: validation.tags, attachmentCount };
  }

  window.VG.ZipManager = {
    exportTasksZip,
    importTasksZip
  };
})();
