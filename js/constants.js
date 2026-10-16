/**
 * vg-task-manager: Constants and Formatting Helpers
 */
(function() {
  window.VG = window.VG || {};

  const STATES = [
    { id: 'planned', label: 'Planned', icon: '📋' },
    { id: 'in progress', label: 'In Progress', icon: '⚡' },
    { id: 'in review', label: 'In Review', icon: '🔍' },
    { id: 'done', label: 'Done', icon: '✅' },
    { id: 'blocked', label: 'Blocked', icon: '⛔' }
  ];

  const PRIORITIES = {
    'blocker': { label: '⛔ Blocker', css: 'prio-bloqueante' },
    'high': { label: '🔥 High', css: 'prio-alta' },
    'medium-high': { label: '⚡ Med-High', css: 'prio-media-alta' },
    'medium': { label: '🔹 Medium', css: 'prio-media' },
    'low': { label: '🌱 Low', css: 'prio-baja' }
  };

  const STATE_MAPPINGS = {
    'planificada': 'planned',
    'planificadas': 'planned',
    'planned': 'planned',
    'todo': 'planned',
    'to do': 'planned',
    'backlog': 'planned',

    'en progreso': 'in progress',
    'en-progreso': 'in progress',
    'progreso': 'in progress',
    'in progress': 'in progress',
    'in-progress': 'in progress',
    'doing': 'in progress',

    'en revisión': 'in review',
    'en revision': 'in review',
    'revision': 'in review',
    'in review': 'in review',
    'review': 'in review',

    'hecha': 'done',
    'hechas': 'done',
    'completada': 'done',
    'completadas': 'done',
    'done': 'done',
    'finished': 'done',

    'bloqueada': 'blocked',
    'bloqueadas': 'blocked',
    'blocked': 'blocked'
  };

  const PRIORITY_MAPPINGS = {
    'bloqueante': 'blocker',
    'blocker': 'blocker',
    'alta': 'high',
    'high': 'high',
    'media-alta': 'medium-high',
    'media alta': 'medium-high',
    'medium-high': 'medium-high',
    'med-high': 'medium-high',
    'media': 'medium',
    'medium': 'medium',
    'normal': 'medium',
    'baja': 'low',
    'low': 'low'
  };

  function canonicalState(val) {
    if (!val) return 'planned';
    const s = String(val).trim().toLowerCase();
    return STATE_MAPPINGS[s] || 'planned';
  }

  function canonicalPriority(val) {
    if (!val) return 'medium';
    const s = String(val).trim().toLowerCase();
    return PRIORITY_MAPPINGS[s] || 'medium';
  }

  /** Collision-free id, safe to use as a folder name (attachments/<taskId>/) */
  function generateId(prefix) {
    const rand = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
    return `${prefix}-${Date.now()}-${rand}`;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeCss(str) {
    return String(str).replace(/\s+/g, '-');
  }

  function formatRelativeTime(dateInput) {
    if (!dateInput) return 'Recently';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Recently';

    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let size = Number(bytes);
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx++;
    }
    return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  function getFileIcon(filename = '') {
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'svg':
        return '🖼️';
      case 'pdf':
        return '📕';
      case 'txt':
      case 'md':
      case 'markdown':
      case 'log':
        return '📝';
      case 'json':
      case 'js':
      case 'ts':
      case 'html':
      case 'css':
      case 'lua':
      case 'py':
      case 'sql':
        return '💻';
      case 'mp3':
      case 'wav':
      case 'ogg':
      case 'm4a':
      case 'flac':
        return '🎵';
      case 'mp4':
      case 'webm':
      case 'mov':
      case 'mkv':
        return '🎬';
      case 'zip':
      case 'tar':
      case 'gz':
      case '7z':
      case 'rar':
        return '📦';
      default:
        return '📎';
    }
  }

  window.VG.Constants = {
    STATES,
    PRIORITIES,
    canonicalState,
    canonicalPriority,
    generateId,
    escapeHtml,
    escapeCss,
    formatRelativeTime,
    formatFileSize,
    getFileIcon
  };
})();
