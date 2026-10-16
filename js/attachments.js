/**
 * vg-task-manager: Attachment Management (File handling, preview, download, sync)
 */
(function() {
  window.VG = window.VG || {};
  const Storage = window.VG.Storage;

  function sanitizeFilename(filename) {
    if (!filename) return 'unnamed_file';
    // Remove directory traversal and dangerous characters
    return filename.replace(/[/\\?%*:|"<>]/g, '_').trim();
  }

  function getUniqueFilename(existingAttachments, originalFilename) {
    let sanitized = sanitizeFilename(originalFilename);
    const existing = new Set((existingAttachments || []).map(a => a.filename.toLowerCase()));
    if (!existing.has(sanitized.toLowerCase())) {
      return sanitized;
    }

    const dotIdx = sanitized.lastIndexOf('.');
    const base = dotIdx !== -1 ? sanitized.substring(0, dotIdx) : sanitized;
    const ext = dotIdx !== -1 ? sanitized.substring(dotIdx) : '';

    let counter = 1;
    while (existing.has(`${base}_${counter}${ext}`.toLowerCase())) {
      counter++;
    }
    return `${base}_${counter}${ext}`;
  }

  async function addAttachmentToTask(task, file, customName = '', customDesc = '') {
    if (!task) throw new Error('Task is required to add an attachment.');
    if (!file) throw new Error('No file selected.');

    task.attachments = task.attachments || [];

    const filename = getUniqueFilename(task.attachments, file.name);
    const id = `att-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const attachmentRecord = {
      id,
      filename,
      name: (customName || '').trim(),
      description: (customDesc || '').trim(),
      size: file.size,
      type: file.type || 'application/octet-stream',
      created_at: new Date().toISOString()
    };

    // Save blob to IndexedDB
    await Storage.saveAttachmentBlob(task.id, filename, file);

    // Push into task metadata
    task.attachments.push(attachmentRecord);
    task.updated_at = new Date().toISOString();

    // If local directory is synced, save directly to disk
    if (window.VG.FsSync && window.VG.FsSync.isLinked()) {
      window.VG.FsSync.writeAttachmentFile(task.id, filename, file).catch(err => {
        console.warn('Could not write attachment to local directory:', err);
      });
      window.VG.FsSync.saveTasksToDirectory().catch(() => {});
    }

    return attachmentRecord;
  }

  async function deleteAttachmentFromTask(task, attachmentId) {
    if (!task || !task.attachments) return false;

    const idx = task.attachments.findIndex(a => a.id === attachmentId);
    if (idx === -1) return false;

    const att = task.attachments[idx];

    // Delete blob from IndexedDB
    await Storage.deleteAttachmentBlob(task.id, att.filename);

    // Remove from task array
    task.attachments.splice(idx, 1);
    task.updated_at = new Date().toISOString();

    // If local directory is synced, remove from disk
    if (window.VG.FsSync && window.VG.FsSync.isLinked()) {
      window.VG.FsSync.deleteAttachmentFile(task.id, att.filename).catch(() => {});
      window.VG.FsSync.saveTasksToDirectory().catch(() => {});
    }

    return true;
  }

  function updateAttachmentDetails(task, attachmentId, newName, newDesc) {
    if (!task || !task.attachments) return false;
    const att = task.attachments.find(a => a.id === attachmentId);
    if (!att) return false;

    att.name = (newName || '').trim();
    att.description = (newDesc || '').trim();
    task.updated_at = new Date().toISOString();

    if (window.VG.FsSync && window.VG.FsSync.isLinked()) {
      window.VG.FsSync.saveTasksToDirectory().catch(() => {});
    }

    return true;
  }

  async function openOrDownloadAttachment(task, attachment, forceDownload = false) {
    const blob = await Storage.getAttachmentBlob(task.id, attachment.filename);
    if (!blob) {
      if (window.VG.App && window.VG.App.showToast) {
        window.VG.App.showToast(`File "${attachment.filename}" is not available locally in memory/disk.`, 'warning');
      } else {
        alert(`File "${attachment.filename}" is not available in local storage.`);
      }
      return;
    }

    const url = URL.createObjectURL(blob);

    // Check if viewable in browser (images, text, pdf) and not forced download
    const isViewable = !forceDownload && (
      attachment.type.startsWith('image/') ||
      attachment.type === 'application/pdf' ||
      attachment.type.startsWith('text/')
    );

    if (isViewable) {
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (window.VG.App && window.VG.App.showToast) {
        window.VG.App.showToast(`Downloaded ${attachment.filename}`, 'success');
      }
    }
  }

  window.VG.Attachments = {
    addAttachmentToTask,
    deleteAttachmentFromTask,
    updateAttachmentDetails,
    openOrDownloadAttachment,
    sanitizeFilename
  };
})();
