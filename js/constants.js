/**
 * bitacore: Constants and Formatting Helpers
 */
(function() {
  window.VG = window.VG || {};

  // `icon` is a Fomantic-UI icon name, `color` a Fomantic-UI color
  const STATES = [
    { id: 'planned', label: 'Planned', icon: 'clipboard list', color: 'blue' },
    { id: 'in progress', label: 'In Progress', icon: 'bolt', color: 'orange' },
    { id: 'in review', label: 'In Review', icon: 'search', color: 'violet' },
    { id: 'done', label: 'Done', icon: 'check circle', color: 'green' },
    { id: 'blocked', label: 'Blocked', icon: 'ban', color: 'red' }
  ];

  const PRIORITIES = {
    'blocker': { label: 'Blocker', icon: 'ban', color: 'red' },
    'high': { label: 'High', icon: 'fire', color: 'orange' },
    'medium-high': { label: 'Med-High', icon: 'bolt', color: 'yellow' },
    'medium': { label: 'Medium', icon: 'circle', color: 'blue' },
    'low': { label: 'Low', icon: 'leaf', color: 'green' }
  };

  const TASK_TYPES = {
    'task': { id: 'task', label: 'Task', icon: 'check square outline', color: 'blue' },
    'bug': { id: 'bug', label: 'Bug', icon: 'bug', color: 'red' },
    'analysis': { id: 'analysis', label: 'Analysis', icon: 'search', color: 'teal' },
    'feature': { id: 'feature', label: 'Feature', icon: 'star', color: 'green' },
    'openspec-change': { id: 'openspec-change', label: 'OpenSpec Change', icon: 'code branch', color: 'purple' }
  };

  const TASK_TYPE_MAPPINGS = {
    'task': 'task',
    'tarea': 'task',
    'bug': 'bug',
    'error': 'bug',
    'defecto': 'bug',
    'analysis': 'analysis',
    'analisis': 'analysis',
    'investigacion': 'analysis',
    'feature': 'feature',
    'funcionalidad': 'feature',
    'mejora': 'feature',
    'openspec-change': 'openspec-change',
    'openspec_change': 'openspec-change',
    'openspec': 'openspec-change',
    'change': 'openspec-change'
  };

  function updateTaskTypes(typesArray) {
    if (!Array.isArray(typesArray) || typesArray.length === 0) return;
    Object.keys(TASK_TYPES).forEach(k => delete TASK_TYPES[k]);
    typesArray.forEach(t => {
      const id = String(t.id || t._id).toLowerCase();
      TASK_TYPES[id] = {
        id,
        label: t.name || t.label || id,
        icon: t.icon || 'check square outline',
        color: t.color || 'blue'
      };
      TASK_TYPE_MAPPINGS[id] = id;
    });
  }

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

  function canonicalTaskType(val) {
    const defaultType = Object.keys(TASK_TYPES)[0] || 'task';
    if (!val) return defaultType;
    const s = String(val).trim().toLowerCase();
    return TASK_TYPE_MAPPINGS[s] || (TASK_TYPES[s] ? s : defaultType);
  }

  /**
   * Returns an array of ancestor IDs for a given task ID.
   * Walks up the parentId chain. Detects cycles safely using a Set.
   */
  function getAncestorIds(taskId, tasks) {
    const ancestors = [];
    const visited = new Set([taskId]);
    const taskMap = new Map((tasks || []).map(t => [t.id, t]));
    let current = taskMap.get(taskId);
    while (current && current.parentId) {
      if (visited.has(current.parentId)) break;
      ancestors.push(current.parentId);
      visited.add(current.parentId);
      current = taskMap.get(current.parentId);
    }
    return ancestors;
  }

  /**
   * Returns an array of descendant IDs for a given task ID.
   * Recursively finds all children, grandchildren, etc.
   */
  function getDescendantIds(taskId, tasks) {
    const descendants = [];
    const queue = [taskId];
    const visited = new Set([taskId]);
    const tasksList = tasks || [];
    while (queue.length > 0) {
      const parent = queue.shift();
      const children = tasksList.filter(t => t.parentId === parent);
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          descendants.push(child.id);
          queue.push(child.id);
        }
      }
    }
    return descendants;
  }

  /**
   * Returns sibling IDs for a given task ID (tasks sharing the same non-null parentId).
   */
  function getSiblingIds(taskId, tasks) {
    const task = (tasks || []).find(t => t.id === taskId);
    if (!task || !task.parentId) return [];
    return (tasks || [])
      .filter(t => t.parentId === task.parentId && t.id !== taskId)
      .map(t => t.id);
  }

  /**
   * Checks if candidateTaskId can be added as a subtask of parentTaskId.
   * Returns { valid: boolean, error?: string }
   */
  function validateSubtaskRelationship(parentTaskId, candidateTaskId, tasks) {
    if (!parentTaskId || !candidateTaskId) {
      return { valid: false, error: 'Both parent and subtask IDs are required.' };
    }
    if (parentTaskId === candidateTaskId) {
      return { valid: false, error: 'A task cannot be its own subtask.' };
    }
    const taskMap = new Map((tasks || []).map(t => [t.id, t]));
    const parent = taskMap.get(parentTaskId);
    const candidate = taskMap.get(candidateTaskId);
    if (!parent) return { valid: false, error: 'Parent task not found.' };
    if (!candidate) return { valid: false, error: 'Candidate task not found.' };

    // 1. Candidate cannot be a sibling of parent
    if (parent.parentId && candidate.parentId && parent.parentId === candidate.parentId) {
      return { valid: false, error: 'Cannot add a sibling task as a subtask.' };
    }
    const siblings = getSiblingIds(parentTaskId, tasks);
    if (siblings.includes(candidateTaskId)) {
      return { valid: false, error: 'Cannot add a sibling task as a subtask.' };
    }

    // 2. Candidate cannot be an ancestor of parent (cycle)
    const parentAncestors = getAncestorIds(parentTaskId, tasks);
    if (parentAncestors.includes(candidateTaskId)) {
      return { valid: false, error: 'Cannot add an ancestor as a subtask (cycle detected).' };
    }

    // 3. Candidate cannot already be a subtask of another task
    if (candidate.parentId && candidate.parentId !== parentTaskId) {
      return { valid: false, error: `Task #${candidateTaskId} is already a subtask of another task. Unlink it first.` };
    }

    return { valid: true };
  }

  /**
   * Returns a list of tasks that can be validly linked as subtasks to parentTaskId.
   */
  function getEligibleSubtasks(parentTaskId, tasks) {
    return (tasks || []).filter(candidate => {
      const res = validateSubtaskRelationship(parentTaskId, candidate.id, tasks);
      return res.valid && candidate.parentId !== parentTaskId;
    });
  }

  /**
   * Links two tasks bidirectionally without hierarchy restrictions.
   * Returns { success: boolean, error?: string }
   */
  function linkTasks(taskId1, taskId2, tasks) {
    if (!taskId1 || !taskId2) {
      return { success: false, error: 'Both task IDs are required to link tasks.' };
    }
    if (taskId1 === taskId2) {
      return { success: false, error: 'A task cannot be linked to itself.' };
    }
    const taskMap = new Map((tasks || []).map(t => [t.id, t]));
    const task1 = taskMap.get(taskId1);
    const task2 = taskMap.get(taskId2);
    if (!task1) return { success: false, error: `Task #${taskId1} not found.` };
    if (!task2) return { success: false, error: `Task #${taskId2} not found.` };

    task1.linkedTaskIds = Array.isArray(task1.linkedTaskIds) ? task1.linkedTaskIds : [];
    task2.linkedTaskIds = Array.isArray(task2.linkedTaskIds) ? task2.linkedTaskIds : [];

    if (!task1.linkedTaskIds.includes(taskId2)) {
      task1.linkedTaskIds.push(taskId2);
    }
    if (!task2.linkedTaskIds.includes(taskId1)) {
      task2.linkedTaskIds.push(taskId1);
    }

    return { success: true };
  }

  /**
   * Unlinks two tasks bidirectionally.
   * Returns { success: boolean }
   */
  function unlinkTasks(taskId1, taskId2, tasks) {
    if (!taskId1 || !taskId2) return { success: false };
    const taskMap = new Map((tasks || []).map(t => [t.id, t]));
    const task1 = taskMap.get(taskId1);
    const task2 = taskMap.get(taskId2);

    if (task1 && Array.isArray(task1.linkedTaskIds)) {
      task1.linkedTaskIds = task1.linkedTaskIds.filter(id => id !== taskId2);
    }
    if (task2 && Array.isArray(task2.linkedTaskIds)) {
      task2.linkedTaskIds = task2.linkedTaskIds.filter(id => id !== taskId1);
    }

    return { success: true };
  }

  /** Collision-free id, safe to use as a folder name (attachments/<taskId>/) */
  function generateId(prefix) {
    const rand = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
    return `${prefix}-${Date.now()}-${rand}`;
  }

  /**
   * Generates a sequential task ID based on the project's format/prefix and the existing tasks list.
   * e.g. format "lud-" with tasks [lud-1, lud-2] -> "lud-3"
   */
  function generateSequentialTaskId(tasksList, format = 'lud-') {
    const list = Array.isArray(tasksList) ? tasksList : [];
    const rawFormat = String(format || 'lud-').trim();
    const hasPlaceholder = /\{n\}/i.test(rawFormat);
    const prefix = hasPlaceholder ? rawFormat.replace(/\{n\}/gi, '') : rawFormat;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped}(\\d+)$`, 'i');

    let maxNum = 0;
    for (const t of list) {
      if (!t) continue;
      const idStr = String(t.id || t._id || '');
      const match = idStr.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    const nextNum = maxNum + 1;
    if (/\{n\}/.test(rawFormat)) {
      return rawFormat.replace(/\{n\}/g, String(nextNum));
    }
    if (/\{N\}/.test(rawFormat)) {
      return rawFormat.replace(/\{N\}/g, String(nextNum));
    }
    return `${rawFormat}${nextNum}`;
  }

  /**
   * Formats a task ID for UI display.
   * Preserves full ID for sequential IDs (e.g. "lud-1", "lud-1000") and only trims legacy long IDs (task-timestamp-uuid).
   */
  function formatTaskId(id) {
    if (!id) return '';
    const str = String(id);
    if (str.startsWith('task-') && str.length > 15) {
      return str.slice(-6);
    }
    return str;
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

  /** Fomantic-UI icon name for a file, from its extension */
  function getFileIcon(filename = '') {
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'avif': case 'bmp':
        return 'file image outline';
      case 'pdf':
        return 'file pdf outline';
      case 'txt': case 'md': case 'markdown': case 'log': case 'csv':
        return 'file alternate outline';
      case 'json': case 'js': case 'ts': case 'html': case 'css': case 'lua': case 'py': case 'sql': case 'xml': case 'yaml': case 'yml':
        return 'file code outline';
      case 'mp3': case 'wav': case 'ogg': case 'm4a': case 'flac':
        return 'file audio outline';
      case 'mp4': case 'webm': case 'mov': case 'mkv':
        return 'file video outline';
      case 'zip': case 'tar': case 'gz': case '7z': case 'rar':
        return 'file archive outline';
      default:
        return 'file outline';
    }
  }

  window.VG.Constants = {
    STATES,
    PRIORITIES,
    TASK_TYPES,
    updateTaskTypes,
    canonicalState,
    canonicalPriority,
    canonicalTaskType,
    getAncestorIds,
    getDescendantIds,
    getSiblingIds,
    validateSubtaskRelationship,
    getEligibleSubtasks,
    linkTasks,
    unlinkTasks,
    generateId,
    generateSequentialTaskId,
    formatTaskId,
    escapeHtml,
    escapeCss,
    formatRelativeTime,
    formatFileSize,
    getFileIcon
  };
})();
