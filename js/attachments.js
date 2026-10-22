/**
 * bitacore: Attachment Management (File handling, preview, download, MongoDB sync)
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

    const currentUser = window.VG.Auth && window.VG.Auth.getCurrentUser();
    const uploader = (currentUser && currentUser.username) ? currentUser.username : '';

    const attachmentRecord = {
      id,
      filename,
      name: (customName || '').trim(),
      description: (customDesc || '').trim(),
      size: file.size,
      type: file.type || 'application/octet-stream',
      created_at: new Date().toISOString(),
      uploader
    };

    // Save blob to IndexedDB for quick local caching/preview
    await Storage.saveAttachmentBlob(task.id, filename, file);

    // Push into task metadata
    task.attachments.push(attachmentRecord);
    task.updated_at = new Date().toISOString();

    // Upload attachment to MongoDB in the cloud
    if (window.VG.MongoSync && window.VG.MongoSync.isConnected()) {
      const written = await window.VG.MongoSync.uploadAttachment(task.id, filename, file);
      if (written && written.fileId) {
        attachmentRecord.fileId = written.fileId;
      } else if (!written && window.VG.App) {
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

    // Delete from MongoDB GridFS
    if (window.VG.MongoSync && window.VG.MongoSync.isConnected()) {
      await window.VG.MongoSync.deleteAttachment(task.id, att.filename, att.fileId, att.database);
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

  async function getAttachmentBlob(task, attachment) {
    if (!task || !attachment) return null;
    let blob = await Storage.getAttachmentBlob(task.id, attachment.filename);

    // If not in local IndexedDB cache, fetch from MongoDB GridFS via MongoSync
    if (!blob && window.VG.MongoSync && window.VG.MongoSync.isConnected() && attachment.fileId) {
      try {
        blob = await window.VG.MongoSync.downloadAttachment(attachment.fileId, attachment.filename, attachment.database);
        if (blob) {
          await Storage.saveAttachmentBlob(task.id, attachment.filename, blob);
        }
      } catch (err) {
        console.warn('Could not fetch attachment from MongoDB GridFS:', err);
      }
    }
    return blob;
  }

  /* -------------------------------------------------------------
   * IMAGE VIEWER / LIGHTBOX
   * ------------------------------------------------------------- */

  let viewerInitialized = false;
  let currentTask = null;
  let currentImageList = [];
  let currentImageIndex = -1;
  let activeViewerBlobUrl = null;
  let isZoomed = false;
  let isSingleMode = false;
  let singleImageData = null;

  let modalEl, backdropEl, titleEl, infoEl, counterEl;
  let zoomBtn, downloadBtn, newTabBtn, closeBtn, prevBtn, nextBtn;
  let stageEl, imgEl, loaderEl;

  function initImageViewer() {
    if (viewerInitialized) return;
    modalEl = document.getElementById('imageViewerModal');
    if (!modalEl) return;

    backdropEl = document.getElementById('imageViewerBackdrop');
    titleEl = document.getElementById('imageViewerTitle');
    infoEl = document.getElementById('imageViewerInfo');
    counterEl = document.getElementById('imageViewerCounter');
    zoomBtn = document.getElementById('btnImageViewerZoom');
    downloadBtn = document.getElementById('btnImageViewerDownload');
    newTabBtn = document.getElementById('btnImageViewerNewTab');
    closeBtn = document.getElementById('btnImageViewerClose');
    prevBtn = document.getElementById('btnImageViewerPrev');
    nextBtn = document.getElementById('btnImageViewerNext');
    stageEl = document.getElementById('imageViewerStage');
    imgEl = document.getElementById('imageViewerImg');
    loaderEl = document.getElementById('imageViewerLoader');

    if (closeBtn) closeBtn.addEventListener('click', closeImageViewer);
    if (backdropEl) backdropEl.addEventListener('click', closeImageViewer);

    if (prevBtn) prevBtn.addEventListener('click', () => navigateImage(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateImage(1));
    if (zoomBtn) zoomBtn.addEventListener('click', toggleZoom);

    if (imgEl) {
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleZoom();
      });
    }

    if (stageEl) {
      stageEl.addEventListener('click', (e) => {
        if (e.target === stageEl && !isZoomed) {
          closeImageViewer();
        }
      });

      // Drag-to-pan in stage when zoomed
      let isPanning = false;
      let startX = 0, startY = 0;
      let scrollLeft = 0, scrollTop = 0;

      stageEl.addEventListener('mousedown', (e) => {
        if (!isZoomed || e.button !== 0) return;
        if (e.target.closest('button, a')) return;
        isPanning = true;
        stageEl.classList.add('is-panning');
        startX = e.pageX - stageEl.offsetLeft;
        startY = e.pageY - stageEl.offsetTop;
        scrollLeft = stageEl.scrollLeft;
        scrollTop = stageEl.scrollTop;
      });

      window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        e.preventDefault();
        const x = e.pageX - stageEl.offsetLeft;
        const y = e.pageY - stageEl.offsetTop;
        stageEl.scrollLeft = scrollLeft - (x - startX);
        stageEl.scrollTop = scrollTop - (y - startY);
      });

      window.addEventListener('mouseup', () => {
        if (isPanning) {
          isPanning = false;
          stageEl.classList.remove('is-panning');
        }
      });
    }

    viewerInitialized = true;
  }

  function toggleZoom() {
    isZoomed = !isZoomed;
    updateZoomUI();
  }

  function updateZoomUI() {
    if (!stageEl || !imgEl || !zoomBtn) return;
    if (isZoomed) {
      stageEl.classList.add('is-zoomed');
      imgEl.classList.add('is-zoomed');
      zoomBtn.innerHTML = '<i class="search minus icon"></i>';
      zoomBtn.setAttribute('title', 'Ajustar a pantalla (Z)');
      requestAnimationFrame(() => {
        stageEl.scrollLeft = Math.max(0, (stageEl.scrollWidth - stageEl.clientWidth) / 2);
        stageEl.scrollTop = Math.max(0, (stageEl.scrollHeight - stageEl.clientHeight) / 2);
      });
    } else {
      stageEl.classList.remove('is-zoomed');
      imgEl.classList.remove('is-zoomed');
      zoomBtn.innerHTML = '<i class="search plus icon"></i>';
      zoomBtn.setAttribute('title', 'Tamaño real 100% (Z)');
      stageEl.scrollLeft = 0;
      stageEl.scrollTop = 0;
    }
  }

  function onViewerKeyDown(e) {
    if (!modalEl || modalEl.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeImageViewer();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateImage(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateImage(-1);
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      toggleZoom();
    }
  }

  function navigateImage(delta) {
    if (isSingleMode || currentImageList.length <= 1) return;
    const nextIndex = (currentImageIndex + delta + currentImageList.length) % currentImageList.length;
    renderViewerImage(nextIndex);
  }

  async function renderViewerImage(index) {
    initImageViewer();
    if (!modalEl) return;

    currentImageIndex = index;
    const att = currentImageList[index];
    if (!att) return;

    isZoomed = false;
    updateZoomUI();

    titleEl.textContent = att.name || att.filename;
    titleEl.title = att.filename;
    infoEl.textContent = `${window.VG.Constants.formatFileSize(att.size)}${att.uploader ? ' · ' + att.uploader : ''}`;
    counterEl.textContent = currentImageList.length > 1 ? `${index + 1} / ${currentImageList.length}` : '';

    if (prevBtn) prevBtn.style.display = currentImageList.length > 1 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = currentImageList.length > 1 ? 'flex' : 'none';

    loaderEl.hidden = false;
    imgEl.style.opacity = '0';

    downloadBtn.onclick = () => {
      openOrDownloadAttachment(currentTask, att, true);
    };

    const targetIndex = index;
    const blob = await getAttachmentBlob(currentTask, att);
    if (currentImageIndex !== targetIndex) return;

    if (!blob) {
      loaderEl.hidden = true;
      if (window.VG.UI && window.VG.UI.toast) {
        window.VG.UI.toast(`No se pudo cargar la imagen "${att.filename}".`, 'warning');
      }
      return;
    }

    if (activeViewerBlobUrl) {
      URL.revokeObjectURL(activeViewerBlobUrl);
    }
    const viewType = getSafeViewType(att) || 'image/png';
    activeViewerBlobUrl = URL.createObjectURL(new Blob([blob], { type: viewType }));

    if (newTabBtn) newTabBtn.href = activeViewerBlobUrl;

    imgEl.onload = () => {
      if (currentImageIndex !== targetIndex) return;
      loaderEl.hidden = true;
      imgEl.style.opacity = '1';
      infoEl.textContent = `${window.VG.Constants.formatFileSize(att.size)} · ${imgEl.naturalWidth} × ${imgEl.naturalHeight}px${att.uploader ? ' · ' + att.uploader : ''}`;
    };

    imgEl.onerror = () => {
      if (currentImageIndex !== targetIndex) return;
      loaderEl.hidden = true;
      if (window.VG.UI && window.VG.UI.toast) {
        window.VG.UI.toast(`Error al mostrar la imagen "${att.filename}".`, 'error');
      }
    };

    imgEl.src = activeViewerBlobUrl;
    imgEl.alt = att.name || att.filename;
  }

  function showImageAttachment(task, identifier) {
    initImageViewer();
    if (!modalEl) return;

    currentTask = task;
    isSingleMode = false;
    singleImageData = null;

    currentImageList = (task && Array.isArray(task.attachments))
      ? task.attachments.filter(a => {
          const vt = getSafeViewType(a);
          return vt && vt.startsWith('image/');
        })
      : [];

    if (currentImageList.length === 0) {
      if (identifier) {
        const anyAtt = (task && task.attachments) ? task.attachments.find(a => a.id === identifier || a.filename === identifier) : null;
        if (anyAtt) {
          openOrDownloadAttachment(task, anyAtt, false);
          return;
        }
      }
      return;
    }

    currentImageIndex = currentImageList.findIndex(a => a.id === identifier || a.filename === identifier);
    if (currentImageIndex === -1) currentImageIndex = 0;

    modalEl.hidden = false;
    document.body.classList.add('image-viewer-open');
    window.addEventListener('keydown', onViewerKeyDown);

    renderViewerImage(currentImageIndex);
  }

  function showSingleImage(options = {}) {
    initImageViewer();
    if (!modalEl || !options.src) return;

    isSingleMode = true;
    singleImageData = options;
    currentImageList = [];
    currentImageIndex = -1;

    isZoomed = false;
    updateZoomUI();

    titleEl.textContent = options.title || options.filename || 'Imagen';
    titleEl.title = options.filename || options.title || '';
    infoEl.textContent = options.info || '';
    counterEl.textContent = '';

    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';

    if (newTabBtn) newTabBtn.href = options.src;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = options.src;
      a.download = options.filename || 'image';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };

    loaderEl.hidden = false;
    imgEl.style.opacity = '0';

    imgEl.onload = () => {
      loaderEl.hidden = true;
      imgEl.style.opacity = '1';
      infoEl.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight}px`;
    };

    imgEl.onerror = () => {
      loaderEl.hidden = true;
      if (window.VG.UI && window.VG.UI.toast) {
        window.VG.UI.toast('Error al visualizar la imagen.', 'error');
      }
    };

    imgEl.src = options.src;
    imgEl.alt = options.title || '';

    modalEl.hidden = false;
    document.body.classList.add('image-viewer-open');
    window.addEventListener('keydown', onViewerKeyDown);
  }

  function closeImageViewer() {
    if (!modalEl || modalEl.hidden) return;
    modalEl.hidden = true;
    document.body.classList.remove('image-viewer-open');
    window.removeEventListener('keydown', onViewerKeyDown);

    if (activeViewerBlobUrl) {
      URL.revokeObjectURL(activeViewerBlobUrl);
      activeViewerBlobUrl = null;
    }
    if (imgEl) imgEl.src = '';
    isZoomed = false;
    updateZoomUI();
  }

  async function openOrDownloadAttachment(task, attachment, forceDownload = false) {
    const viewType = forceDownload ? null : getSafeViewType(attachment);

    // Image attachments open in the lightbox viewer unless forced to download
    if (viewType && viewType.startsWith('image/')) {
      showImageAttachment(task, attachment.id || attachment.filename);
      return;
    }

    let blob = await getAttachmentBlob(task, attachment);

    if (!blob) {
      if (window.VG.UI && window.VG.UI.toast) {
        window.VG.UI.toast(`File "${attachment.filename}" is not available in MongoDB.`, 'warning');
      }
      return;
    }

    if (viewType) {
      const url = URL.createObjectURL(new Blob([blob], { type: viewType }));
      const win = window.open(url, '_blank', 'noopener');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
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
    init: initImageViewer,
    addAttachmentToTask,
    deleteAttachmentFromTask,
    updateAttachmentDetails,
    openOrDownloadAttachment,
    getAttachmentBlob,
    showImageAttachment,
    showSingleImage,
    closeImageViewer,
    getSafeViewType,
    sanitizeFilename
  };
})();
