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

    return { valid: true, list };
  }

  function normalizeTasks(raw) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : (raw.tasks || []);

    return list.map(t => {
      const id = t.id || `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
        id: c.id || `comm-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        author: (c.author !== undefined ? c.author : c.autor) || 'User',
        text: (c.text !== undefined ? c.text : c.texto) || '',
        timestamp: c.timestamp || new Date().toISOString()
      }));

      // Attachments normalization (filename, name, description, size, type, created_at)
      const rawAttachments = Array.isArray(t.attachments) ? t.attachments : (Array.isArray(t.adjuntos) ? t.adjuntos : []);
      const attachments = rawAttachments.map(a => {
        const filename = (a.filename || a.nombre_archivo || 'file.bin').trim();
        const customName = (a.name !== undefined ? a.name : (a.nombre || '')).trim();
        const customDesc = (a.description !== undefined ? a.description : (a.descripcion || '')).trim();
        return {
          id: a.id || `att-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
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
