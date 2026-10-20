/**
 * vg-task-manager: Strict Task Schema Validation and Normalization
 */
(function() {
  window.VG = window.VG || {};
  const { canonicalState, canonicalPriority, canonicalTaskType } = window.VG.Constants;

  function validateTasksJson(parsed) {
    if (!parsed) {
      return { valid: false, error: 'Empty content: JSON is null or undefined.' };
    }

    let list = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
      list = parsed.tasks;
    } else {
      return {
        valid: false,
        error: 'Invalid format: JSON root must be an array of task objects (e.g. [ { "name": "..." } ]) or an object with a "tasks" array property.'
      };
    }

    // Optional tag registry at the root: { "tags": [ "name" | { "name", "color" } ], "tasks": [...] }
    const rawTags = !Array.isArray(parsed) ? parsed.tags : undefined;
    if (rawTags !== undefined && rawTags !== null) {
      if (!Array.isArray(rawTags)) {
        return { valid: false, error: `Invalid format: the root "tags" property must be an array of tag names or { "name": "..." } objects.` };
      }
      for (let i = 0; i < rawTags.length; i++) {
        const tag = rawTags[i];
        const tagName = typeof tag === 'string' ? tag : (tag && typeof tag === 'object' ? tag.name : undefined);
        if (typeof tagName !== 'string' || tagName.trim().length === 0) {
          return { valid: false, error: `Invalid tag #${i + 1} in the root "tags" list: every tag needs a non-empty name.` };
        }
      }
    }

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const num = i + 1;

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return {
          valid: false,
          error: `Invalid task at index ${num}: Expected a task object, but found ${item === null ? 'null' : Array.isArray(item) ? 'an array' : typeof item}.`
        };
      }

      const taskName = item.name !== undefined ? item.name : item.nombre;
      if (taskName === undefined || taskName === null || typeof taskName !== 'string' || taskName.trim().length === 0) {
        return {
          valid: false,
          error: `Invalid task at index ${num}: Missing or empty 'name' property. Every task must have a name.`
        };
      }

      const rawType = item.type !== undefined ? item.type : item.tipo;
      if (rawType !== undefined && rawType !== null && typeof rawType !== 'string') {
        return {
          valid: false,
          error: `Invalid task #${num} ("${taskName}"): 'type' must be a string.`
        };
      }

      const rawParentId = item.parentId !== undefined ? item.parentId : (item.parent_id !== undefined ? item.parent_id : item.padre);
      if (rawParentId !== undefined && rawParentId !== null && typeof rawParentId !== 'string') {
        return {
          valid: false,
          error: `Invalid task #${num} ("${taskName}"): 'parentId' must be a string or null.`
        };
      }

      const rawStatus = item.status !== undefined ? item.status : item.estado;
      if (rawStatus !== undefined && rawStatus !== null && typeof rawStatus !== 'string') {
        return {
          valid: false,
          error: `Invalid task #${num} ("${taskName}"): 'status' must be a string.`
        };
      }

      const rawPriority = item.priority !== undefined ? item.priority : item.prioridad;
      if (rawPriority !== undefined && rawPriority !== null && typeof rawPriority !== 'string') {
        return {
          valid: false,
          error: `Invalid task #${num} ("${taskName}"): 'priority' must be a string.`
        };
      }

      const rawHistory = item.history !== undefined ? item.history : item.historial;
      if (rawHistory !== undefined && rawHistory !== null && !Array.isArray(rawHistory)) {
        return {
          valid: false,
          error: `Invalid task #${num} ("${taskName}"): 'history' must be an array.`
        };
      }

      const rawComments = item.comments !== undefined ? item.comments : item.comentarios;
      if (rawComments !== undefined && rawComments !== null && !Array.isArray(rawComments)) {
        return {
          valid: false,
          error: `Invalid task #${num} ("${taskName}"): 'comments' must be an array.`
        };
      }

      const rawTaskTags = item.tags !== undefined ? item.tags : item.etiquetas;
      if (rawTaskTags !== undefined && rawTaskTags !== null && typeof rawTaskTags !== 'string' &&
          !(Array.isArray(rawTaskTags) && rawTaskTags.every(tg => typeof tg === 'string'))) {
        return {
          valid: false,
          error: `Invalid task #${num} ("${taskName}"): 'tags' must be an array of tag names.`
        };
      }

      const rawAttachments = item.attachments !== undefined ? item.attachments : item.adjuntos;
      if (rawAttachments !== undefined && rawAttachments !== null) {
        if (!Array.isArray(rawAttachments)) {
          return {
            valid: false,
            error: `Invalid task #${num} ("${taskName}"): 'attachments' must be an array.`
          };
        }
        for (let a = 0; a < rawAttachments.length; a++) {
          const att = rawAttachments[a];
          if (!att || typeof att !== 'object' || Array.isArray(att)) {
            return {
              valid: false,
              error: `Invalid attachment #${a + 1} in task #${num} ("${taskName}"): attachment must be an object.`
            };
          }
          const fname = att.filename || att.nombre_archivo;
          if (!fname || typeof fname !== 'string' || fname.trim().length === 0) {
            return {
              valid: false,
              error: `Invalid attachment #${a + 1} in task #${num} ("${taskName}"): missing required 'filename'.`
            };
          }
        }
      }

      const rawLinked = item.linkedTaskIds !== undefined ? item.linkedTaskIds : (item.linked_tasks !== undefined ? item.linked_tasks : (item.tareas_enlazadas !== undefined ? item.tareas_enlazadas : item.enlaces));
      if (rawLinked !== undefined && rawLinked !== null) {
        if (!Array.isArray(rawLinked) || !rawLinked.every(id => typeof id === 'string' && id.trim().length > 0)) {
          return {
            valid: false,
            error: `Invalid task #${num} ("${taskName}"): 'linkedTaskIds' must be an array of task ID strings.`
          };
        }
      }
    }

    return { valid: true, list, tags: Array.isArray(rawTags) ? rawTags : [] };
  }

  function isSafeId(id) {
    return id.length > 0 && id.length <= 128 && id !== '.' && id !== '..' && !/[/\\\x00-\x1f]/.test(id);
  }

  function normalizeTasks(raw) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : (raw.tasks || []);

    const seenIds = new Set();

    return list.map(t => {
      // Ids name the attachments/<taskId>/ folder: they must be unique and path-safe
      let id = t.id !== undefined && t.id !== null ? String(t.id).trim() : '';
      if (!isSafeId(id) || seenIds.has(id)) {
        const format = (window.VG.App && window.VG.App.getActiveProjectTaskIdFormat && window.VG.App.getActiveProjectTaskIdFormat()) || 'lud-';
        id = window.VG.Constants.generateSequentialTaskId
          ? window.VG.Constants.generateSequentialTaskId(list, format)
          : window.VG.Constants.generateId('task');
      }
      seenIds.add(id);
      const name = (t.name !== undefined ? t.name : t.nombre) || 'Untitled';
      const description = (t.description !== undefined ? t.description : t.descripcion) || '';
      const openspecRaw = t['openspec-id'] !== undefined ? t['openspec-id'] : (t.openspec_id !== undefined ? t.openspec_id : '');
      const openspecId = typeof openspecRaw === 'string' ? openspecRaw.trim() : String(openspecRaw || '').trim();
      const priority = canonicalPriority(t.priority || t.prioridad);
      const status = canonicalState(t.status || t.estado);
      const rawType = t.type !== undefined ? t.type : (t.tipo !== undefined ? t.tipo : 'task');
      const type = canonicalTaskType(rawType);

      const rawParentId = t.parentId !== undefined ? t.parentId : (t.parent_id !== undefined ? t.parent_id : (t.padre !== undefined ? t.padre : null));
      const parentId = (typeof rawParentId === 'string' && rawParentId.trim().length > 0) ? rawParentId.trim() : null;
      const createdAt = t.created_at || t.creada_en || new Date().toISOString();
      const updatedAt = t.updated_at || t.actualizada_en || new Date().toISOString();

      // Board position: saved so a reload restores the exact order left by the
      // user, including manual drag-and-drop moves.
      const rawBoardOrder = t.board_order !== undefined ? t.board_order
        : (t.boardOrder !== undefined ? t.boardOrder : null);
      const boardOrderNum = (rawBoardOrder === null || rawBoardOrder === '') ? NaN : Number(rawBoardOrder);
      const boardOrder = Number.isFinite(boardOrderNum) ? boardOrderNum : null;

      // Assignee and Reporter normalization
      const rawAssignee = t.assignee !== undefined ? t.assignee : (t.asignado_a !== undefined ? t.asignado_a : (t.asignado !== undefined ? t.asignado : null));
      const assignee = (typeof rawAssignee === 'string' && rawAssignee.trim().length > 0) ? rawAssignee.trim() : null;

      const rawReporter = t.reporter !== undefined ? t.reporter : (t.informante !== undefined ? t.informante : (t.creador !== undefined ? t.creador : ''));
      const reporter = (typeof rawReporter === 'string' && rawReporter.trim().length > 0) ? rawReporter.trim() : '';

      // History normalization
      const rawHistory = Array.isArray(t.history) ? t.history : (Array.isArray(t.historial) ? t.historial : []);
      const history = rawHistory.map(h => {
        const fromRaw = h.from_status !== undefined ? h.from_status : (h.previous_status !== undefined ? h.previous_status : h.estado_anterior);
        const toRaw = h.to_status !== undefined ? h.to_status : (h.new_status !== undefined ? h.new_status : h.estado_nuevo);
        const reasonRaw = h.reason !== undefined ? h.reason : (h.motivo || '');
        const userRaw = h.user !== undefined ? h.user : (h.usuario !== undefined ? h.usuario : (h.author || null));
        return {
          from_status: fromRaw ? canonicalState(fromRaw) : null,
          to_status: canonicalState(toRaw),
          timestamp: h.timestamp || new Date().toISOString(),
          reason: reasonRaw,
          user: (userRaw && typeof userRaw === 'string') ? userRaw.trim() : null
        };
      });

      // Comments normalization
      const rawComments = Array.isArray(t.comments) ? t.comments : (Array.isArray(t.comentarios) ? t.comentarios : []);
      const comments = rawComments.map(c => ({
        id: c.id || window.VG.Constants.generateId('comm'),
        author: (c.author !== undefined ? c.author : c.autor) || 'User',
        text: (c.text !== undefined ? c.text : c.texto) || '',
        timestamp: c.timestamp || new Date().toISOString()
      }));

      const tags = window.VG.Tags.normalizeList(t.tags !== undefined ? t.tags : t.etiquetas);

      // Attachments normalization (filename, name, description, size, type, created_at, uploader)
      const rawAttachments = Array.isArray(t.attachments) ? t.attachments : (Array.isArray(t.adjuntos) ? t.adjuntos : []);
      const attachments = rawAttachments.map(a => {
        const filename = (a.filename || a.nombre_archivo || 'file.bin').trim();
        const customName = (a.name !== undefined ? a.name : (a.nombre || '')).trim();
        const customDesc = (a.description !== undefined ? a.description : (a.descripcion || '')).trim();
        const uploaderRaw = a.uploader !== undefined ? a.uploader : (a.uploaded_by !== undefined ? a.uploaded_by : (a.subido_por || ''));
        const uploader = (typeof uploaderRaw === 'string' && uploaderRaw.trim().length > 0) ? uploaderRaw.trim() : '';
        return {
          id: a.id || window.VG.Constants.generateId('att'),
          filename: filename,
          name: customName,
          description: customDesc,
          size: typeof a.size === 'number' ? a.size : 0,
          type: a.type || 'application/octet-stream',
          created_at: a.created_at || a.creado_en || new Date().toISOString(),
          uploader
        };
      });

      const favorite = Boolean(
        t.favorite !== undefined ? t.favorite :
        (t.destacada !== undefined ? t.destacada :
        (t.destacado !== undefined ? t.destacado :
        (t.favorita !== undefined ? t.favorita :
        (t.favorito !== undefined ? t.favorito :
        (t.starred !== undefined ? t.starred : false)))))
      );

      const rawLinked = t.linkedTaskIds !== undefined ? t.linkedTaskIds : (t.linked_tasks !== undefined ? t.linked_tasks : (t.tareas_enlazadas !== undefined ? t.tareas_enlazadas : (t.enlaces !== undefined ? t.enlaces : [])));
      const linkedTaskIds = Array.isArray(rawLinked)
        ? Array.from(new Set(rawLinked.filter(id => typeof id === 'string' && id.trim().length > 0).map(id => id.trim())))
        : [];

      return {
        id,
        name,
        description,
        'openspec-id': openspecId,
        type,
        parentId,
        linkedTaskIds,
        priority,
        status,
        favorite,
        assignee,
        reporter,
        tags,
        created_at: createdAt,
        updated_at: updatedAt,
        ...(boardOrder !== null ? { board_order: boardOrder } : {}),
        history,
        comments,
        attachments
      };
    });
  }

  /**
   * Returns tasks in the order they should be displayed on the board.
   *
   * Tasks with a saved `board_order` keep the positions the user left them in
   * (manual drag-and-drop included). Legacy tasks without it are placed first,
   * newest edit first, using `updated_at` as a fallback. The resulting order is
   * stamped back onto every task so the next save makes it permanent.
   */
  function orderTasks(raw) {
    const list = Array.isArray(raw) ? raw.slice() : [];

    const ordered = [];
    const unordered = [];
    list.forEach(t => {
      if (!t) return;
      const n = Number(t.board_order);
      if (t.board_order !== undefined && t.board_order !== null && Number.isFinite(n)) {
        ordered.push(t);
      } else {
        unordered.push(t);
      }
    });

    ordered.sort((a, b) => Number(a.board_order) - Number(b.board_order));
    unordered.sort((a, b) => {
      const aTime = Date.parse(a.updated_at || a.created_at || '') || 0;
      const bTime = Date.parse(b.updated_at || b.created_at || '') || 0;
      if (aTime !== bTime) return bTime - aTime;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const sorted = unordered.concat(ordered);
    sorted.forEach((t, index) => {
      t.board_order = index;
    });
    return sorted;
  }

  window.VG.Validation = {
    validateTasksJson,
    normalizeTasks,
    orderTasks
  };
})();
