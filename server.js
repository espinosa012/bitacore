#!/usr/bin/env node

/**
 * vg-task-manager: HTTP Server & MongoDB Atlas Sync Backend
 * Serves the web UI and provides API endpoints for:
 *   - Connecting to MongoDB Atlas (vg-task-manager database, tasks and attachments collections)
 *   - Querying, creating, updating, and deleting tasks
 *   - Storing, streaming, and deleting attachment files in MongoDB
 *   - User authentication and authorization via JWT
 *
 * Usage:
 *   node server.js [mongo-uri]
 *
 * Environment:
 *   VG_PORT             first port to try (default 8766)
 *   VG_MONGO_URI        MongoDB Atlas connection string (optional default)
 *   VG_ALLOWED_ORIGINS  extra comma-separated origins allowed for CORS
 *   VG_NO_OPEN=1        do not open the browser automatically
 *   API_JWT_SECRET      override the JWT signing secret (default: built-in static key)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const { createToken, verifyToken, verifyRequest } = require('./auth');

const APP_DIR = __dirname;
const INDEX_FILE = path.join(APP_DIR, 'index.html');
const FIRST_PORT = parseInt(process.env.VG_PORT, 10) || 8766;
const MAX_ATTEMPTS = 20;
const MAX_BODY = 100 * 1024 * 1024; // 100 MB max body size

const DB_NAME = 'vg-task-manager';
const DEFAULT_URI = process.env.VG_MONGO_URI || (process.argv[2] && process.argv[2].startsWith('mongodb') ? process.argv[2] : null);

// MongoDB state
let mongoClient = null;
let mongoDb = null;
let activeUri = null;

// Origins allowed to call the API cross-origin
const ALLOWED_ORIGINS = new Set([
  'https://espinosa012.github.io',
  ...(process.env.VG_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
    const [salt, key] = stored.split(':');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const keyBuf = Buffer.from(key, 'hex');
    const hashBuf = Buffer.from(hash, 'hex');
    if (keyBuf.length !== hashBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, keyBuf);
  } catch (e) {
    return false;
  }
}

async function connectMongo(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('A valid MongoDB connection URI is required');
  }
  const cleanUri = uri.trim().replace(/^["']|["']$/g, '');

  if (mongoClient) {
    try {
      await mongoClient.close();
    } catch (e) {
      // ignore
    }
    mongoClient = null;
    mongoDb = null;
    activeUri = null;
  }

  const client = new MongoClient(cleanUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
  });

  await client.connect();
  const db = client.db(DB_NAME);
  await db.command({ ping: 1 });

  mongoClient = client;
  mongoDb = db;
  activeUri = cleanUri;

  const taskCount = await db.collection('tasks').countDocuments().catch(() => 0);
  const userCount = await db.collection('users').countDocuments().catch(() => 0);
  console.log(`[MongoDB] Connected to database "${DB_NAME}". Total tasks: ${taskCount}, Total users: ${userCount}`);
  return { ok: true, database: DB_NAME, taskCount, userCount };
}

async function disconnectMongo() {
  if (mongoClient) {
    try {
      await mongoClient.close();
    } catch (e) {
      // ignore
    }
  }
  mongoClient = null;
  mongoDb = null;
  activeUri = null;
  console.log('[MongoDB] Disconnected.');
  return { ok: true };
}

function maskUri(uri) {
  if (!uri) return null;
  return uri.replace(/:([^@]+)@/, ':****@');
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error(`Could not open browser automatically: ${err.message}`);
  });
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort, attempts) {
  for (let p = startPort; p < startPort + attempts; p++) {
    const available = await checkPort(p);
    if (available) return p;
  }
  throw new Error(`No free port found between ${startPort} and ${startPort + attempts - 1}`);
}

function isLoopbackOrigin(origin) {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch (e) {
    return false;
  }
}

/** CORS headers */
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (origin === 'null') {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Private-Network': 'true'
    };
  }
  if (!ALLOWED_ORIGINS.has(origin) && !isLoopbackOrigin(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin'
  };
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isSafeSegment(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 &&
    !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}

/** Parse multipart/form-data body from raw Buffer using manual parsing */
function parseMultipartBody(bodyBuffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
  if (!boundaryMatch) {
    return { fields: {}, files: [] }; // Not multipart - no files
  }
  const boundary = '--' + boundaryMatch[1];
  const parts = bodyBuffer.split(Buffer.from('\r\n' + boundary));
  const fields = {};
  const files = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part === '\r\n' || part === '--\r\n' || part === '\r\n' + boundary || part === '--\r\n') continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const filenameMatch = headerStr.match(/filename="([^\"]*)\"/);
    if (filenameMatch) {
      files.push({ name, filename: filenameMatch[1] || null, data });
    } else {
      fields[name] = data.toString('utf8');
    }
  }
  return { fields, files };
}

/** Parse multipart/form-data body from raw Buffer using manual parsing */
function parseMultipartBody(bodyBuffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
  if (!boundaryMatch) {
    return { fields: {}, files: [] }; // Not multipart - no files
  }
  const boundary = '--' + boundaryMatch[1];
  const parts = bodyBuffer.split(Buffer.from('\r\n' + boundary));
  const fields = {};
  const files = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part === '\r\n' || part === '--\r\n' || part === '\r\n' + boundary || part === '--\r\n') continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const filenameMatch = headerStr.match(/filename="([^"]*)"/);
    if (filenameMatch) {
      files.push({ name, filename: filenameMatch[1] || null, data });
    } else {
      fields[name] = data.toString('utf8');
    }
  }
  return { fields, files };
}

/** Parse multipart/form-data body from a raw Buffer */
function parseMultipart(bodyBuffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
  if (!boundaryMatch) throw new Error('Missing multipart boundary');
  const boundary = '--' + boundaryMatch[1];

  const parts = bodyBuffer.split(Buffer.from('\r\n' + boundary));
  const fields = {};
  const files = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.length || part.toString().includes('--\r\n')) continue;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const body = part.slice(headerEnd + 4).replace(/\r\n$/, '');

    const dispositionMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"/);
    if (!dispositionMatch) continue;
    const fieldName = dispositionMatch[1];

    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      files.push({
        fieldName: fieldName,
        filename: filenameMatch[1],
        data: body
      });
    } else {
      fields[fieldName] = body.toString('utf8');
    }
  }

  return { fields, files };
}

async function handleApi(req, res, pathname, cors) {
  // 1. Connection status: GET /api/status or /api/mongo/status
  if ((pathname === '/api/status' || pathname === '/api/mongo/status') && req.method === 'GET') {
    const isConnected = !!mongoDb;
    let count = 0;
    let userCount = 0;
    if (isConnected) {
      try {
        count = await mongoDb.collection('tasks').countDocuments();
        userCount = await mongoDb.collection('users').countDocuments().catch(() => 0);
      } catch (e) {
        // ignore
      }
    }
    return sendJson(res, 200, {
      ok: true,
      app: 'vg-task-manager',
      connected: isConnected,
      database: isConnected ? DB_NAME : null,
      taskCount: count,
      userCount,
      maskedUri: maskUri(activeUri)
    }, cors);
  }

  // 2. Connect to MongoDB: POST /api/mongo/connect
  if (pathname === '/api/mongo/connect' && req.method === 'POST') {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + err.message }, cors);
    }
    if (!parsed || !parsed.uri) {
      return sendJson(res, 400, { ok: false, error: 'Connection string "uri" is required' }, cors);
    }
    try {
      const stats = await connectMongo(parsed.uri);
      return sendJson(res, 200, {
        ok: true,
        database: DB_NAME,
        taskCount: stats.taskCount,
        userCount: stats.userCount,
        maskedUri: maskUri(activeUri)
      }, cors);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: 'Could not connect to MongoDB: ' + err.message }, cors);
    }
  }

  // 2.1 Disconnect from MongoDB: POST /api/mongo/disconnect
  if (pathname === '/api/mongo/disconnect' && req.method === 'POST') {
    await disconnectMongo();
    return sendJson(res, 200, { ok: true, connected: false }, cors);
  }

  // 3. Register User: POST /api/auth/register
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB. Please connect first.' }, cors);
    }
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + err.message }, cors);
    }
    const username = (parsed && parsed.username ? String(parsed.username) : '').trim();
    const password = parsed && parsed.password ? String(parsed.password) : '';

    if (!username || username.length < 2 || username.length > 40) {
      return sendJson(res, 400, { ok: false, error: 'Username must be between 2 and 40 characters.' }, cors);
    }
    if (!/^[\w.-]+$/.test(username)) {
      return sendJson(res, 400, { ok: false, error: 'Username can only contain letters, numbers, underscores, dots, and hyphens.' }, cors);
    }
    if (!password || password.length < 3) {
      return sendJson(res, 400, { ok: false, error: 'Password must be at least 3 characters long.' }, cors);
    }

    try {
      const usersCol = mongoDb.collection('users');
      const lower = username.toLowerCase();
      const existing = await usersCol.findOne({ usernameLower: lower });
      if (existing) {
        return sendJson(res, 409, { ok: false, error: 'Username is already taken. Please choose another or log in.' }, cors);
      }

      const passwordHash = hashPassword(password);
      const userDoc = {
        username,
        usernameLower: lower,
        password: passwordHash,
        createdAt: new Date().toISOString()
      };
      await usersCol.insertOne(userDoc);
      const token = createToken(username);
      return sendJson(res, 201, {
        ok: true,
        token,
        user: { username, createdAt: userDoc.createdAt }
      }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Failed to register user: ' + err.message }, cors);
    }
  }

  // 3.1 Login User: POST /api/auth/login
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB. Please connect first.' }, cors);
    }
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + err.message }, cors);
    }
    const username = (parsed && parsed.username ? String(parsed.username) : '').trim();
    const password = parsed && parsed.password ? String(parsed.password) : '';

    if (!username || !password) {
      return sendJson(res, 400, { ok: false, error: 'Username and password are required.' }, cors);
    }

    try {
      const usersCol = mongoDb.collection('users');
      const lower = username.toLowerCase();
      const userDoc = await usersCol.findOne({ usernameLower: lower });
      if (!userDoc || !verifyPassword(password, userDoc.password)) {
        return sendJson(res, 401, { ok: false, error: 'Invalid username or password.' }, cors);
      }

      const token = createToken(userDoc.username);
      return sendJson(res, 200, {
        ok: true,
        token,
        user: { username: userDoc.username, createdAt: userDoc.createdAt }
      }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Failed to authenticate: ' + err.message }, cors);
    }
  }

  // 3.2 Logout User: POST /api/auth/logout
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    // JWT tokens can't be invalidated server-side.
    // Server returns success; clients must discard the token.
    return sendJson(res, 200, { ok: true, message: 'Logged out. Discard your token.' }, cors);
  }

  // 3.3 List Users: GET /api/users
  if (pathname === '/api/users' && req.method === 'GET') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    }
    try {
      const list = await mongoDb.collection('users')
        .find({}, { projection: { password: 0 } })
        .sort({ username: 1 })
        .toArray();
      const users = list.map(u => ({ username: u.username, createdAt: u.createdAt }));
      return sendJson(res, 200, { ok: true, users }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message }, cors);
    }
  }

  // 4. Tasks endpoints: GET / PUT / POST /api/tasks
  if (pathname === '/api/tasks') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB. Please connect first.' }, cors);
    }

    if (req.method === 'GET') {
      try {
        // Parse query parameters for filtering/pagination
        const params = new URLSearchParams(pathname.includes('?') ? pathname.split('?')[1] : '');
        const urlObj = new URL(req.url, 'http://localhost');
        const queryParams = new URLSearchParams(urlObj.search);

        const filter = {};
        // Build MongoDB filter from query params
        if (queryParams.get('status')) filter.status = { $in: [queryParams.get('status')] };
        if (queryParams.get('priority')) filter.priority = queryParams.get('priority');
        if (queryParams.get('assignee')) filter.assignee = queryParams.get('assignee');
        if (queryParams.get('tag')) filter.tags = queryParams.get('tag');
        if (queryParams.get('favorite') !== null) {
          const fav = queryParams.get('favorite');
          filter.favorite = fav === 'true' || fav === '1';
        }

        let query = mongoDb.collection('tasks').find(filter || {}).sort({});

        // Pagination
        const limit = parseInt(queryParams.get('limit') || '1000', 10);
        const offset = parseInt(queryParams.get('offset') || '0', 10);
        if (!isNaN(limit) && limit > 0) query = query.limit(limit);
        if (!isNaN(offset) && offset > 0) query = query.skip(offset);

        const rawTasks = await query.toArray();
        const normalized = rawTasks.map(t => {
          const id = t.id || t._id;
          const copy = { ...t, id: String(id), favorite: Boolean(t.favorite) };
          delete copy._id;
          return copy;
        });

        // Load tag registry
        const tagDoc = await mongoDb.collection('tags').findOne({ _id: 'registry' }).catch(() => null);
        const tags = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];

        // Optional search via query param (client-side filtering still possible)
        const search = queryParams.get('search');
        let finalTasks = normalized;
        if (search) {
          const term = search.toLowerCase();
          finalTasks = normalized.filter(t => {
            const text = [t.name, t.description, t['openspec-id'], ...(t.tags || [])]
              .join(' ').toLowerCase();
            return text.includes(term) || (t.attachments || []).some(a => a.filename.toLowerCase().includes(term));
          });
        }

        return sendJson(res, 200, {
          tags,
          tasks: finalTasks,
          pagination: {
            total: normalized.length,
            returned: finalTasks.length,
            limit: parseInt(queryParams.get('limit') || '1000', 10),
            offset: parseInt(queryParams.get('offset') || '0', 10)
          }
        }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Failed to read tasks from MongoDB: ' + err.message }, cors);
      }
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + err.message }, cors);
      }

      const tasksList = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null);
      if (!tasksList) {
        return sendJson(res, 400, { ok: false, error: 'JSON payload must contain an array of tasks or { tags, tasks }' }, cors);
      }

      try {
        // Save tags registry
        if (parsed && Array.isArray(parsed.tags)) {
          await mongoDb.collection('tags').updateOne(
            { _id: 'registry' },
            { $set: { tags: parsed.tags, updatedAt: new Date() } },
            { upsert: true }
          );
        }

        const taskCol = mongoDb.collection('tasks');
        if (tasksList.length > 0) {
          const ops = tasksList.map(t => {
            const id = t.id || t._id;
            const doc = { ...t, _id: id, id };
            return {
              updateOne: {
                filter: { _id: id },
                update: { $set: doc },
                upsert: true
              }
            };
          });
          await taskCol.bulkWrite(ops);
        }

        // Remove deleted tasks from collection
        const currentIds = tasksList.map(t => t.id || t._id);
        await taskCol.deleteMany({ _id: { $nin: currentIds } });

        return sendJson(res, 200, { ok: true, count: tasksList.length }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Failed to save tasks to MongoDB: ' + err.message }, cors);
      }
    }
  }

  // 5. Single Task: PUT / DELETE /api/tasks/<id>
  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch) {
    if (!mongoDb) return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    const taskId = decodeURIComponent(taskMatch[1]);

    // GET method for single task
    if (req.method === 'GET') {
      try {
        const doc = await mongoDb.collection('tasks').findOne({ _id: taskId });
        if (!doc) {
          return sendJson(res, 404, { ok: false, error: 'Task not found' }, cors);
        }
        const id = doc.id || doc._id;
        const normalized = { ...doc, id: String(id), favorite: Boolean(doc.favorite) };
        delete normalized._id;
        return sendJson(res, 200, { ok: true, task: normalized }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'DELETE') {
      try {
        await mongoDb.collection('tasks').deleteOne({ _id: taskId });
        await mongoDb.collection('attachments').deleteMany({ taskId });
        return sendJson(res, 200, { ok: true }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const task = JSON.parse(body.toString('utf8'));
        const now = new Date().toISOString();

        // Check if status changed to record history entry
        const existing = await mongoDb.collection('tasks').findOne({ _id: taskId });
        if (existing) {
          task._id = taskId;
          task.id = taskId;
          // Preserve created_at, update updated_at
          task.updated_at = now;
          if (!task.history) task.history = existing.history || [];

          // If status changed, append a history entry
          const prevStatus = existing.status;
          const newStatus = task.status;
          if (prevStatus !== newStatus) {
            task.history.push({
              from_status: prevStatus || null,
              to_status: newStatus,
              timestamp: now,
              reason: 'Status changed via API',
              user: req.user && req.user.username
            });
          }
        } else {
          task._id = taskId;
          task.id = taskId;
          task.created_at = now;
          task.updated_at = now;
          if (!task.history) task.history = [];
        }

        await mongoDb.collection('tasks').updateOne({ _id: taskId }, { $set: task }, { upsert: true });
        return sendJson(res, 200, { ok: true }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  // 6. Attachment endpoints: /api/tasks/<id>/attachments
  const taskAttachmentsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/attachments\/?(.*)$/);
  if (taskAttachmentsMatch) {
    if (!mongoDb) return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    const taskId = encodeURIComponent(taskAttachmentsMatch[1]);

    if (req.method === 'GET') {
             // List attachments
      try {
        const task = await mongoDb.collection('tasks').findOne({ _id: taskId });
        if (!task) return sendJson(res, 404, { ok: false, error: 'Task not found' }, cors);
        return sendJson(res, 200, { ok: true, attachments: task.attachments || [] }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'POST') {
      // Upload file to task
      try {
        const body = await readBody(req);
        const contentType = req.headers['content-type'] || '';
        const { fields, files } = parseMultipartBody(body, contentType);
        if (files.length === 0) return sendJson(res, 400, { ok: false, error: 'No file uploaded' }, cors);
        if (files.length > 1) return sendJson(res, 400, { ok: false, error: 'Only one file can be uploaded at a time' }, cors);
        const file = files[0];
        if (!file.filename || !file.data) return sendJson(res, 400, { ok: false, error: 'Invalid file data' }, cors);
        const attachment = {
          filename: file.filename,
          contentType: MIME_TYPES[path.extname(file.filename).toLowerCase()] || 'application/octet-stream',
          size: file.data.length,
          uploadedAt: new Date().toISOString(),
          userId: req.user?.username || null
        };
        const result = await mongoDb.collection('tasks').updateOne(
          { _id: taskId },
          { $push: { attachments: attachment }, $set: { updated_at: new Date().toISOString() } }
        );
        if (result.matchedCount === 0) return sendJson(res, 404, { ok: false, error: 'Task not found' }, cors);
        return sendJson(res, 200, { ok: true, attachment, message: 'File uploaded successfully' }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Failed to upload file: ' + err.message }, cors);
      }
    }

    if (req.method === 'DELETE') {
      // Delete all attachments for a task
      try {
        await mongoDb.collection('tasks').updateOne(
          { _id: taskId },
          { $set: { 'attachments': [], 'updated_at': new Date().toISOString() } }
        );
        return sendJson(res, 200, { ok: true, message: 'All attachments deleted' }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  // 7. Single attachment CRUD for a task: /api/tasks/<id>/attachments/<filename>
  const singleAttachmentMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/attachments\/([^/]+)$/);
  if (singleAttachmentMatch) {
    if (!mongoDb) return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    const taskId = decodeURIComponent(singleAttachmentMatch[1]);
    const filename = decodeURIComponent(singleAttachmentMatch[2]);

    if (!isSafeSegment(taskId) || !isSafeSegment(filename)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid task id or filename' }, cors);
    }

    if (req.method === 'GET') {
      try {
        const task = await mongoDb.collection('tasks').findOne({ _id: taskId });
        if (!task || !task.attachments) return sendJson(res, 404, { ok: false, error: 'Attachment not found' }, cors);
        const att = task.attachments.find(a => a.filename === filename);
        if (!att) return sendJson(res, 404, { ok: false, error: 'Attachment not found' }, cors);
        return sendJson(res, 200, { ok: true, attachment: att }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'PUT') {
      // Upload/update file for task
      try {
        const body = await readBody(req);
        const contentType = req.headers['content-type'] || '';
        
        // Parse multipart data
        const { fields, files } = parseMultipartBody(body, contentType);
        
        // Expect exactly one file
        if (files.length === 0) {
          return sendJson(res, 400, { ok: false, error: 'No file uploaded' }, cors);
        }
        if (files.length > 1) {
          return sendJson(res, 400, { ok: false, error: 'Only one file can be uploaded at a time' }, cors);
        }
        
        const file = files[0];
        if (!file.filename || !file.data) {
          return sendJson(res, 400, { ok: false, error: 'Invalid file data' }, cors);
        }
        
        // Validate file size (already done in readBody via MAX_BODY)
        
        // Create/update attachment object
        const attachment = {
          filename: file.filename,
          contentType: req.headers['content-type']?.includes('boundary') 
            ? (file.data.length > 0 ? 'application/octet-stream' : '') // Will be set properly below
            : 'application/octet-stream',
          size: file.data.length,
          uploadedAt: new Date().toISOString(),
          userId: req.user?.username || null
        };
        
        // Try to detect content type from filename if not set
        if (attachment.contentType === 'application/octet-stream') {
          const ext = path.extname(file.filename).toLowerCase();
          attachment.contentType = MIME_TYPES[ext] || 'application/octet-stream';
        }
        
        // First remove any existing attachment with same filename, then add new one
        await mongoDb.collection('tasks').updateOne(
          { _id: taskId },
          { 
            $pull: { attachments: { filename: file.filename } },
            $set: { updated_at: new Date().toISOString() }
          }
        );
        
        // Then add the new attachment
        const result = await mongoDb.collection('tasks').updateOne(
          { _id: taskId },
          { 
            $push: { attachments: attachment },
            $set: { updated_at: new Date().toISOString() }
          }
        );
        
        if (result.matchedCount === 0) {
          return sendJson(res, 404, { ok: false, error: 'Task not found' }, cors);
        }
        
        return sendJson(res, 200, { 
          ok: true, 
          attachment: attachment,
          message: 'File uploaded successfully' 
        }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Failed to upload file: ' + err.message }, cors);
      }
    }

    if (req.method === 'DELETE') {
      try {
        const result = await mongoDb.collection('tasks').updateOne(
          { _id: taskId },
          { $pull: { attachments: { filename: filename } }, $set: { updated_at: new Date().toISOString() } }
        );
        if (result.matchedCount === 0) {
          return sendJson(res, 404, { ok: false, error: 'Task not found' }, cors);
        }
        if (result.modifiedCount === 0) {
          return sendJson(res, 404, { ok: false, error: 'Attachment not found' }, cors);
        }
        return sendJson(res, 200, { ok: true }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  // Legacy attachment endpoints (backwards-compatible with original /api/attachments)
  if (pathname === '/api/attachments' && req.method === 'GET') {
    if (!mongoDb) return sendJson(res, 200, [], cors);
    try {
      const list = await mongoDb.collection('attachments')
        .find({}, { projection: { data: 0 } })
        .toArray();
      return sendJson(res, 200, list, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message }, cors);
    }
  }

  // Legacy single attachment: GET / PUT / DELETE /api/attachments/<taskId>/<filename>
  const attMatch = pathname.match(/^\/api\/attachments\/([^/]+)\/([^/]+)$/);
  if (attMatch) {
    if (!mongoDb) return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    const taskId = decodeURIComponent(attMatch[1]);
    const filename = decodeURIComponent(attMatch[2]);
    if (!isSafeSegment(taskId) || !isSafeSegment(filename)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid task id or filename' }, cors);
    }

    if (req.method === 'GET') {
      try {
        const doc = await mongoDb.collection('attachments').findOne({ taskId, filename });
        if (!doc || !doc.data) {
          return sendJson(res, 404, { ok: false, error: 'Attachment not found in MongoDB' }, cors);
        }
        const ext = path.extname(filename).toLowerCase();
        const contentType = doc.contentType || MIME_TYPES[ext] || 'application/octet-stream';
        const buffer = doc.data.buffer ? Buffer.from(doc.data.buffer) : doc.data;
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': buffer.length,
          'Cache-Control': 'no-cache',
          ...cors
        });
        return res.end(buffer);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const ext = path.extname(filename).toLowerCase();
        const contentType = req.headers['content-type'] || MIME_TYPES[ext] || 'application/octet-stream';
        await mongoDb.collection('attachments').updateOne(
          { taskId, filename },
          {
            $set: {
              taskId,
              filename,
              data: body,
              size: body.length,
              contentType,
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );
        return sendJson(res, 200, { ok: true, size: body.length }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'DELETE') {
      try {
        await mongoDb.collection('attachments').deleteOne({ taskId, filename });
        return sendJson(res, 200, { ok: true }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  return sendJson(res, 404, { error: 'Unknown API endpoint' }, cors);
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method Not Allowed');
  }

  const targetFile = (pathname === '/' || pathname === '/index.html')
    ? INDEX_FILE
    : path.join(APP_DIR, pathname.replace(/^\/+/, ''));

  const safeTarget = path.normalize(targetFile);
  const relative = path.relative(APP_DIR, safeTarget);
  const isHidden = relative.split(path.sep).some(seg => seg.startsWith('.'));
  if ((!safeTarget.startsWith(APP_DIR + path.sep) && safeTarget !== INDEX_FILE) || isHidden) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(safeTarget, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(safeTarget).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(safeTarget);
    stream.on('error', streamErr => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading file: ' + streamErr.message);
    });
    stream.pipe(res);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith('/api/')) {
      const cors = corsHeaders(req);
      if (cors === null) {
        return sendJson(res, 403, { error: `Origin ${req.headers.origin} is not allowed` });
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }

      // JWT auth middleware - verifyRequest protects all routes except public ones
      const verify = verifyRequest(req, res, pathname);
      if (!verify.valid) {
        return sendJson(res, 401, verify.error, cors);
      }

      try {
        await handleApi(req, res, pathname, cors);
      } catch (err) {
        if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message }, cors);
      }
      return;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Bad Request');
    }
    serveStatic(req, res, decoded);
  });
}

async function main() {
  try {
    const port = await findAvailablePort(FIRST_PORT, MAX_ATTEMPTS);
    const server = createServer();

    // If an initial MongoDB URI was provided in environment or CLI, connect now
    if (DEFAULT_URI) {
      console.log(`Connecting to MongoDB using configured URI...`);
      try {
        await connectMongo(DEFAULT_URI);
      } catch (err) {
        console.warn(`Initial MongoDB connection failed: ${err.message}. You can connect from the web interface.`);
      }
    }

    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`;
      console.log(`\nvg-task-manager running: ${url} (Press Ctrl+C to stop)`);
      console.log(`MongoDB target: database "${DB_NAME}", collection "tasks"`);
      if (mongoDb) {
        console.log(`Status: Connected to MongoDB Atlas (${maskUri(activeUri)})\n`);
      } else {
        console.log(`Status: Waiting for MongoDB connection string from web UI\n`);
      }
      if (!process.env.VG_NO_OPEN) openBrowser(url);
    });

    const shutdown = async () => {
      console.log('\nStopping vg-task-manager...');
      await disconnectMongo();
      server.close(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error(`Error starting vg-task-manager: ${err.message}`);
    process.exit(1);
  }
}

main();