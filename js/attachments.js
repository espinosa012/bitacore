/**
 * vg-task-manager: Attachment Management (File handling, preview, download, MongoDB sync)
 */
(function() {
  window.VG = window.VG || {};
  const Storage = window.VG.Storage;

  function sanitizeFilename(filename) {
    if (!filename) return 'unnamed_file';
    return filename.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_').trim().replace(/^\.+/, '_') || 'unnamed_file';
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
    const id = window.VG.Constants.generateId('att');

    const attachmentRecord = {
      id,
      filename,
      name: (customName || '').trim(),
      description: (customDesc || '').trim(),
      size: file.size,
      type: file.type || 'application/octet-stream',
      created_at: new Date().toISOString()
    };

    // Save blob to IndexedDB for quick local caching/preview
    await Storage.saveAttachmentBlob(task.id, filename, file);

    // Push into task metadata
    task.attachments.push(attachmentRecord);
    task.updated_at = new Date().toISOString();

    // Upload attachment to MongoDB in the cloud
    if (window.VG.MongoSync && window.VG.MongoSync.isConnected()) {
      const written = await window.VG.MongoSync.uploadAttachment(task.id, filename, file);
      if (!written && window.VG.App) {
        window.VG.App.showToast(`Could not upload "${filename}" to MongoDB`, 'error', 6000);
      }
    }

    return attachmentRecord;
  }

  async function deleteAttachmentFromTask(task, attachmentId) {
    if (!task || !task.attachments) return false;

    const idx = task.attachments.findIndex(a => a.id === attachmentId);
    if (idx === -1) return false;

    const att = task.attachments[idx];

    // Delete blob from local cache
    await Storage.deleteAttachmentBlob(task.id, att.filename);

    // Remove from task array
    task.attachments.splice(idx, 1);
    task.updated_at = new Date().toISOString();

    // Delete from MongoDB
    if (window.VG.MongoSync && window.VG.MongoSync.isConnected()) {
      await window.VG.MongoSync.deleteAttachment(task.id, att.filename);
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
    return true;
  }

  const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
  const IMAGE_EXTENSIONS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
  const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'json', 'js', 'ts', 'css', 'lua', 'py', 'sql', 'yaml', 'yml', 'xml', 'html', 'htm', 'svg']);

  /** MIME type to open an attachment inline with, or null if it should be downloaded */
  function getSafeViewType(attachment) {
    const type = (attachment.type || '').toLowerCase().split(';')[0].trim();
    const ext = (attachment.filename || '').split('.').pop().toLowerCase();
    if (SAFE_IMAGE_TYPES.has(type)) return type;
    if (IMAGE_EXTENSIONS[ext]) return IMAGE_EXTENSIONS[ext];
    if (type === 'application/pdf' || ext === 'pdf') return 'application/pdf';
    if (type.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) return 'text/plain;charset=utf-8';
    return null;
  }

  async function openOrDownloadAttachment(task, attachment, forceDownload = false) {
    let blob = await Storage.getAttachmentBlob(task.id, attachment.filename);

    // If not in local IndexedDB cache, fetch from MongoDB
    if (!blob) {
      try {
        const url = `/api/attachments/${encodeURIComponent(task.id)}/${encodeURIComponent(attachment.filename)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          blob = await res.blob();
          await Storage.saveAttachmentBlob(task.id, attachment.filename, blob);
        }
      } catch (err) {
        console.warn('Could not fetch attachment from MongoDB:', err);
      }
    }

    if (!blob) {
      window.VG.UI.toast(`File "${attachment.filename}" is not available in MongoDB.`, 'warning');
      return;
    }

    const viewType = forceDownload ? null : getSafeViewType(attachment);

    if (viewType) {
      const url = URL.createObjectURL(new Blob([blob], { type: viewType }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
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
    getSafeViewType,
    sanitizeFilename
  };
})();
