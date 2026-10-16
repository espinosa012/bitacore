/**
 * vg-task-manager: Strict Task Schema Validation and Normalization
 */
(function() {
  window.VG = window.VG || {};
  const { canonicalState, canonicalPriority } = window.VG.Constants;

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
        id = window.VG.Constants.generateId('task');
      }
      seenIds.add(id);
      const name = (t.name !== undefined ? t.name : t.nombre) || 'Untitled';
      const description = (t.description !== undefined ? t.description : t.descripcion) || '';
      const openspecRaw = t['openspec-id'] !== undefined ? t['openspec-id'] : (t.openspec_id !== undefined ? t.openspec_id : '');
      const openspecId = typeof openspecRaw === 'string' ? openspecRaw.trim() : String(openspecRaw || '').trim();
      const priority = canonicalPriority(t.priority || t.prioridad);
      const status = canonicalState(t.status || t.estado);
      const createdAt = t.created_at || t.creada_en || new Date().toISOString();
      const updatedAt = t.updated_at || t.actualizada_en || new Date().toISOString();

      // History normalization
      const rawHistory = Array.isArray(t.history) ? t.history : (Array.isArray(t.historial) ? t.historial : []);
      const history = rawHistory.map(h => {
        const fromRaw = h.from_status !== undefined ? h.from_status : (h.previous_status !== undefined ? h.previous_status : h.estado_anterior);
        const toRaw = h.to_status !== undefined ? h.to_status : (h.new_status !== undefined ? h.new_status : h.estado_nuevo);
        const reasonRaw = h.reason !== undefined ? h.reason : (h.motivo || '');
        return {
          from_status: fromRaw ? canonicalState(fromRaw) : null,
          to_status: canonicalState(toRaw),
          timestamp: h.timestamp || new Date().toISOString(),
          reason: reasonRaw
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

      // Attachments normalization (filename, name, description, size, type, created_at)
      const rawAttachments = Array.isArray(t.attachments) ? t.attachments : (Array.isArray(t.adjuntos) ? t.adjuntos : []);
      const attachments = rawAttachments.map(a => {
        const filename = (a.filename || a.nombre_archivo || 'file.bin').trim();
        const customName = (a.name !== undefined ? a.name : (a.nombre || '')).trim();
        const customDesc = (a.description !== undefined ? a.description : (a.descripcion || '')).trim();
        return {
          id: a.id || window.VG.Constants.generateId('att'),
          filename: filename,
          name: customName,
          description: customDesc,
          size: typeof a.size === 'number' ? a.size : 0,
          type: a.type || 'application/octet-stream',
          created_at: a.created_at || a.creado_en || new Date().toISOString()
        };
      });

      return {
        id,
        name,
        description,
        'openspec-id': openspecId,
        priority,
        status,
        tags,
        created_at: createdAt,
        updated_at: updatedAt,
        history,
        comments,
        attachments
      };
    });
  }

  window.VG.Validation = {
    validateTasksJson,
    normalizeTasks
  };
})();
