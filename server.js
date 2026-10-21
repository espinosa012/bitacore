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
const { createToken, verifyToken, verifyRequest, isAdminUser } = require('./auth');

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

const DEFAULT_PROJECT = {
  _id: 'project-ludum',
  id: 'project-ludum',
  name: 'Project Ludum',
  description: 'Default primary project',
  'task-id-format': 'lud-',
  taskIdFormat: 'lud-',
  createdAt: new Date().toISOString()
};

async function seedDefaultProjects(db) {
  try {
    const col = db.collection('projects');
    await col.updateOne(
      { _id: DEFAULT_PROJECT._id },
      {
        $setOnInsert: {
          _id: DEFAULT_PROJECT._id,
          id: DEFAULT_PROJECT.id,
          name: DEFAULT_PROJECT.name,
          description: DEFAULT_PROJECT.description,
          createdAt: DEFAULT_PROJECT.createdAt
        },
        $set: {
          'task-id-format': DEFAULT_PROJECT['task-id-format'],
          taskIdFormat: DEFAULT_PROJECT.taskIdFormat
        }
      },
      { upsert: true }
    );
    return await col.countDocuments();
  } catch (err) {
    console.error('[MongoDB] Error seeding projects:', err.message);
    return 0;
  }
}

const DEFAULT_TASK_TYPES = [
  { id: 'task', name: 'Task', icon: 'check square outline', color: 'blue' },
  { id: 'bug', name: 'Bug', icon: 'bug', color: 'red' },
  { id: 'analysis', name: 'Analysis', icon: 'search', color: 'teal' },
  { id: 'feature', name: 'Feature', icon: 'star', color: 'green' }
];

// All projects share one database. Tasks carry a `project` field; task types
// and tag registries are stored per project under project-prefixed ids.
function tagRegistryId(projectId) {
  return `registry:${projectId}`;
}

function taskTypeDocId(projectId, typeId) {
  return `${projectId}:${typeId}`;
}

function taskTypeDoc(projectId, t) {
  const typeId = String(t.id || t._id).replace(/^.*:/, '');
  return {
    _id: taskTypeDocId(projectId, typeId),
    id: typeId,
    project: projectId,
    name: t.name || t.label || typeId,
    icon: t.icon || 'check square outline',
    color: t.color || 'blue'
  };
}

function normalizeTaskType(t) {
  return {
    id: t.id || String(t._id).replace(/^.*:/, ''),
    name: t.name,
    icon: t.icon,
    color: t.color
  };
}

async function seedProjectDefaults(db, projectId) {
  for (const tt of DEFAULT_TASK_TYPES) {
    const doc = taskTypeDoc(projectId, tt);
    await db.collection('task_types').updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  }
  await db.collection('tags').updateOne(
    { _id: tagRegistryId(projectId) },
    { $setOnInsert: { project: projectId, tags: [], updatedAt: new Date() } },
    { upsert: true }
  );
}

async function ensureProjectTaskTypes(db, projectId) {
  try {
    const count = await db.collection('task_types').countDocuments({ project: projectId }).catch(() => 0);
    if (count === 0) {
      await seedProjectDefaults(db, projectId);
    }
  } catch (err) {
    console.error(`[MongoDB] Error ensuring task_types for project "${projectId}":`, err.message);
  }
}

async function copyProjectDatabase(db, projectId, oldDb) {
  const tasks = await oldDb.collection('tasks').find({}).toArray();
  for (const t of tasks) {
    const id = String(t.id || t._id);
    // Legacy attachment binaries stay in the old database; remember where
    const attachments = Array.isArray(t.attachments)
      ? t.attachments.map(a => (a && !a.database ? { ...a, database: oldDb.databaseName } : a))
      : [];
    try {
      await db.collection('tasks').updateOne(
        { _id: id, project: projectId },
        { $set: { ...t, _id: id, id, project: projectId, attachments } },
        { upsert: true }
      );
    } catch (err) {
      console.warn(`[MongoDB] Could not migrate task ${id} from "${oldDb.databaseName}":`, err.message);
    }
  }

  const types = await oldDb.collection('task_types').find({}).toArray();
  for (const t of types) {
    const doc = taskTypeDoc(projectId, t);
    await db.collection('task_types').updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  }

  const tagDoc = await oldDb.collection('tags').findOne({ _id: 'registry' });
  if (tagDoc && Array.isArray(tagDoc.tags)) {
    await db.collection('tags').updateOne(
      { _id: tagRegistryId(projectId) },
      { $setOnInsert: { project: projectId, tags: tagDoc.tags, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  const legacyAttachments = await oldDb.collection('attachments').find({}).toArray();
  for (const att of legacyAttachments) {
    const { _id, ...rest } = att;
    await db.collection('attachments').updateOne(
      { taskId: att.taskId, filename: att.filename, project: projectId },
      { $setOnInsert: { ...rest, project: projectId } },
      { upsert: true }
    );
  }
}

/**
 * One-off migration from one database per project (and unscoped task types
 * and tag registry) to the shared database layout. Safe to run repeatedly.
 */
async function migrateToSharedDb(db) {
  const defaultId = DEFAULT_PROJECT.id;
  await db.collection('tasks').updateMany({ project: { $exists: false } }, { $set: { project: defaultId } });
  await db.collection('attachments').updateMany({ project: { $exists: false } }, { $set: { project: defaultId } });

  const legacyTags = await db.collection('tags').findOne({ _id: 'registry' });
  if (legacyTags) {
    await db.collection('tags').updateOne(
      { _id: tagRegistryId(defaultId) },
      { $setOnInsert: { project: defaultId, tags: Array.isArray(legacyTags.tags) ? legacyTags.tags : [], updatedAt: new Date() } },
      { upsert: true }
    );
    await db.collection('tags').deleteOne({ _id: 'registry' });
  }

  const legacyTypes = await db.collection('task_types').find({ project: { $exists: false } }).toArray();
  for (const t of legacyTypes) {
    const doc = taskTypeDoc(defaultId, t);
    await db.collection('task_types').updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  }
  if (legacyTypes.length > 0) {
    await db.collection('task_types').deleteMany({ project: { $exists: false } });
  }

  const projects = await db.collection('projects').find({ dbName: { $exists: true } }).toArray();
  for (const p of projects) {
    const projectId = p.id || p._id;
    const oldDbName = String(p.dbName || '').trim();
    if (oldDbName && oldDbName !== DB_NAME) {
      await copyProjectDatabase(db, projectId, mongoClient.db(oldDbName));
    }
    await db.collection('projects').updateOne(
      { _id: p._id },
      { $set: { migratedFromDb: oldDbName || null }, $unset: { dbName: '' } }
    );
  }

  await db.collection('tasks').createIndex({ project: 1 });
  await db.collection('task_types').createIndex({ project: 1 });
  await db.collection('attachments').createIndex({ project: 1, taskId: 1, filename: 1 });
}

async function getAllDescendantIds(db, projectId, rootTaskId) {
  const descendantIds = [];
  const queue = [rootTaskId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = await db.collection('tasks').find({ project: projectId, parentId: currentId }, { projection: { _id: 1, id: 1 } }).toArray();
    for (const child of children) {
      const childId = String(child.id || child._id);
      if (!descendantIds.includes(childId)) {
        descendantIds.push(childId);
        queue.push(childId);
      }
    }
  }
  return descendantIds;
}

// Scans every project's tasks: ids are collection-wide `_id`s, so they must
// stay unique even if two projects share a prefix
async function generateNextTaskId(db, format = 'lud-') {
  const rawFormat = String(format || 'lud-').trim();
  const hasPlaceholder = /\{n\}/i.test(rawFormat);
  const prefix = hasPlaceholder ? rawFormat.replace(/\{n\}/gi, '') : rawFormat;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}(\\d+)$`, 'i');

  const tasks = await db.collection('tasks').find(
    {},
    { projection: { id: 1, _id: 1 } }
  ).toArray();

  let maxNum = 0;
  for (const t of tasks) {
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

  const projectCount = await seedDefaultProjects(db);
  try {
    await migrateToSharedDb(db);
  } catch (err) {
    console.error('[MongoDB] Shared database migration failed:', err.message);
  }
  await ensureProjectTaskTypes(db, DEFAULT_PROJECT.id);
  const typeCount = await db.collection('task_types').countDocuments().catch(() => 0);
  const taskCount = await db.collection('tasks').countDocuments().catch(() => 0);
  const userCount = await db.collection('users').countDocuments().catch(() => 0);
  console.log(`[MongoDB] Connected to database "${DB_NAME}". Total tasks: ${taskCount}, Total users: ${userCount}, Task types: ${typeCount}, Total projects: ${projectCount}`);
  return { ok: true, database: DB_NAME, taskCount, userCount, typeCount, projectCount };
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

async function resolveProjectContext(req) {
  if (!mongoDb || !mongoClient) {
    return { ok: false, status: 403, error: 'Not connected to MongoDB' };
  }

  let userProjects = req.user && Array.isArray(req.user.projects) ? req.user.projects : ['project-ludum'];
  if (req.user && req.user.username) {
    try {
      const userDoc = await mongoDb.collection('users').findOne(
        { usernameLower: req.user.username.toLowerCase() },
        { projection: { projects: 1 } }
      );
      if (userDoc) {
        userProjects = Array.isArray(userDoc.projects) ? userDoc.projects : ['project-ludum'];
        req.user.projects = userProjects;
      }
    } catch (e) {
      // ignore
    }
  }

  const isAdmin = req.user && Boolean(req.user.isAdmin);
  if (!isAdmin && userProjects.length === 0) {
    return {
      ok: false,
      status: 403,
      error: 'No projects assigned to user account.'
    };
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const requestedProjectId = req.headers['x-project-id'] || urlObj.searchParams.get('projectId') || null;

  if (!isAdmin && requestedProjectId && !userProjects.includes(requestedProjectId)) {
    return {
      ok: false,
      status: 403,
      error: `Access denied. You are not a member of project "${requestedProjectId}".`
    };
  }

  const targetProjectId = requestedProjectId || userProjects[0] || 'project-ludum';

  const projectsCol = mongoDb.collection('projects');
  let projectDoc = await projectsCol.findOne({ _id: targetProjectId });
  if (!projectDoc) {
    projectDoc = await projectsCol.findOne({ id: targetProjectId });
  }
  if (!projectDoc && targetProjectId === 'project-ludum') {
    projectDoc = DEFAULT_PROJECT;
  }

  if (!projectDoc) {
    return {
      ok: false,
      status: 404,
      error: `Project "${targetProjectId}" not found.`
    };
  }

  if (!projectDoc['task-id-format'] && !projectDoc.taskIdFormat) {
    const format = targetProjectId === 'project-ludum' ? 'lud-' : `${targetProjectId}-`;
    projectDoc['task-id-format'] = format;
    projectDoc.taskIdFormat = format;
  }

  const projectId = projectDoc.id || projectDoc._id;
  await ensureProjectTaskTypes(mongoDb, projectId);

  return {
    ok: true,
    project: projectDoc,
    projectId
  };
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

  // 2.2 Bootstrap Status: GET /api/auth/bootstrap-status
  if (pathname === '/api/auth/bootstrap-status' && req.method === 'GET') {
    if (!mongoDb) {
      return sendJson(res, 200, { ok: true, bootstrapNeeded: false, error: 'Not connected to MongoDB' }, cors);
    }
    try {
      const userCount = await mongoDb.collection('users').countDocuments().catch(() => 0);
      return sendJson(res, 200, { ok: true, bootstrapNeeded: userCount === 0 }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message }, cors);
    }
  }

  // 2.3 Bootstrap Initial Administrator: POST /api/auth/bootstrap
  if (pathname === '/api/auth/bootstrap' && req.method === 'POST') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB. Please connect first.' }, cors);
    }
    try {
      const usersCol = mongoDb.collection('users');
      const userCount = await usersCol.countDocuments().catch(() => 0);
      if (userCount > 0) {
        return sendJson(res, 403, { ok: false, error: 'Bootstrap registration is disabled because users already exist.' }, cors);
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

      const passwordHash = hashPassword(password);
      const userDoc = {
        username,
        usernameLower: username.toLowerCase(),
        password: passwordHash,
        projects: ['project-ludum'],
        isAdmin: true,
        createdAt: new Date().toISOString()
      };
      await usersCol.insertOne(userDoc);
      const token = createToken(username, ['project-ludum'], true);
      return sendJson(res, 201, {
        ok: true,
        token,
        user: { username, projects: ['project-ludum'], isAdmin: true, createdAt: userDoc.createdAt }
      }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Failed to bootstrap administrator: ' + err.message }, cors);
    }
  }

  // 3. Register User: POST /api/auth/register (restricted to administrator)
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB. Please connect first.' }, cors);
    }
    if (!isAdminUser(req)) {
      return sendJson(res, 403, { ok: false, error: 'Public registration is disabled. Only administrators can create users.' }, cors);
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
        return sendJson(res, 409, { ok: false, error: 'Username is already taken. Please choose another.' }, cors);
      }

      const projects = Array.isArray(parsed.projects) && parsed.projects.length > 0
        ? parsed.projects
        : ['project-ludum'];
      const passwordHash = hashPassword(password);
      const userDoc = {
        username,
        usernameLower: lower,
        password: passwordHash,
        projects,
        isAdmin: Boolean(parsed.isAdmin),
        createdAt: new Date().toISOString()
      };
      await usersCol.insertOne(userDoc);
      const token = createToken(username, projects, userDoc.isAdmin);
      return sendJson(res, 201, {
        ok: true,
        token,
        user: { username, projects, isAdmin: userDoc.isAdmin, createdAt: userDoc.createdAt }
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

      const userProjects = Array.isArray(userDoc.projects) && userDoc.projects.length > 0
        ? userDoc.projects
        : ['project-ludum'];
      const isAdmin = Boolean(userDoc.isAdmin);
      const token = createToken(userDoc.username, userProjects, isAdmin);
      return sendJson(res, 200, {
        ok: true,
        token,
        user: { username: userDoc.username, projects: userProjects, isAdmin, createdAt: userDoc.createdAt }
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
      const users = list.map(u => ({
        username: u.username,
        projects: Array.isArray(u.projects) && u.projects.length > 0 ? u.projects : ['project-ludum'],
        isAdmin: Boolean(u.isAdmin),
        createdAt: u.createdAt
      }));
      return sendJson(res, 200, { ok: true, users }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message }, cors);
    }
  }

  // 3.3.1 Admin Users Management: /api/admin/users
  if (pathname.startsWith('/api/admin/users')) {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    }
    if (!isAdminUser(req)) {
      return sendJson(res, 403, { ok: false, error: 'Access denied. Administrative role required.' }, cors);
    }

    const subpath = pathname.replace('/api/admin/users', '').replace(/^\/+/, '');
    const usersCol = mongoDb.collection('users');

    // GET /api/admin/users -> List all users
    if (req.method === 'GET' && !subpath) {
      try {
        const list = await usersCol.find({}, { projection: { password: 0 } }).sort({ username: 1 }).toArray();
        const users = list.map(u => ({
          username: u.username,
          projects: Array.isArray(u.projects) && u.projects.length > 0 ? u.projects : ['project-ludum'],
          isAdmin: Boolean(u.isAdmin),
          createdAt: u.createdAt
        }));
        return sendJson(res, 200, { ok: true, users }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    // POST /api/admin/users -> Create user
    if (req.method === 'POST' && !subpath) {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + e.message }, cors);
      }
      const username = (parsed.username || '').trim();
      const password = parsed.password || '';
      if (!username || username.length < 2 || username.length > 40) {
        return sendJson(res, 400, { ok: false, error: 'Username must be between 2 and 40 characters.' }, cors);
      }
      if (!/^[\w.-]+$/.test(username)) {
        return sendJson(res, 400, { ok: false, error: 'Username contains invalid characters.' }, cors);
      }
      if (!password || password.length < 3) {
        return sendJson(res, 400, { ok: false, error: 'Password must be at least 3 characters long.' }, cors);
      }
      const lower = username.toLowerCase();
      const existing = await usersCol.findOne({ usernameLower: lower });
      if (existing) {
        return sendJson(res, 409, { ok: false, error: 'Username already exists.' }, cors);
      }
      const projects = Array.isArray(parsed.projects) && parsed.projects.length > 0 ? parsed.projects : ['project-ludum'];
      const userDoc = {
        username,
        usernameLower: lower,
        password: hashPassword(password),
        projects,
        isAdmin: Boolean(parsed.isAdmin),
        createdAt: new Date().toISOString()
      };
      await usersCol.insertOne(userDoc);
      return sendJson(res, 201, {
        ok: true,
        user: { username, projects, isAdmin: userDoc.isAdmin, createdAt: userDoc.createdAt }
      }, cors);
    }

    // PUT /api/admin/users/:username -> Update user projects/password/isAdmin
    if (req.method === 'PUT' && subpath) {
      const targetUser = decodeURIComponent(subpath);
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + e.message }, cors);
      }
      const updateFields = {};
      if (Array.isArray(parsed.projects)) {
        updateFields.projects = parsed.projects;
      }
      if (typeof parsed.isAdmin === 'boolean') {
        updateFields.isAdmin = parsed.isAdmin;
      }
      if (parsed.password && parsed.password.length >= 3) {
        updateFields.password = hashPassword(parsed.password);
      }
      updateFields.updatedAt = new Date().toISOString();

      const result = await usersCol.updateOne(
        { usernameLower: targetUser.toLowerCase() },
        { $set: updateFields }
      );
      if (result.matchedCount === 0) {
        return sendJson(res, 404, { ok: false, error: `User "${targetUser}" not found.` }, cors);
      }
      return sendJson(res, 200, { ok: true, message: `User "${targetUser}" updated.` }, cors);
    }

    // DELETE /api/admin/users/:username -> Delete user
    if (req.method === 'DELETE' && subpath) {
      const targetUser = decodeURIComponent(subpath);
      if (req.user && req.user.username && req.user.username.toLowerCase() === targetUser.toLowerCase()) {
        return sendJson(res, 400, { ok: false, error: 'You cannot delete your own administrator account.' }, cors);
      }
      const result = await usersCol.deleteOne({ usernameLower: targetUser.toLowerCase() });
      if (result.deletedCount === 0) {
        return sendJson(res, 404, { ok: false, error: `User "${targetUser}" not found.` }, cors);
      }
      return sendJson(res, 200, { ok: true, message: `User "${targetUser}" deleted.` }, cors);
    }
  }

  // 3.3.2 Admin Projects Management: /api/admin/projects
  if (pathname === '/api/admin/projects') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    }
    if (!isAdminUser(req)) {
      return sendJson(res, 403, { ok: false, error: 'Access denied. Administrative role required.' }, cors);
    }

    if (req.method === 'GET') {
      const allProjects = await mongoDb.collection('projects').find({}).toArray();
      const normalized = allProjects.map(p => ({
        id: p.id || p._id,
        name: p.name,
        description: p.description || '',
        'task-id-format': p['task-id-format'] || p.taskIdFormat || `${p.id || p._id}-`,
        createdAt: p.createdAt || null
      }));
      return sendJson(res, 200, { ok: true, projects: normalized }, cors);
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + e.message }, cors);
      }

      const id = (parsed.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const name = (parsed.name || '').trim();
      const description = (parsed.description || '').trim();

      if (!id || id.length < 2) {
        return sendJson(res, 400, { ok: false, error: 'Project ID is required (min 2 alphanumeric/hyphen characters).' }, cors);
      }
      if (!name) {
        return sendJson(res, 400, { ok: false, error: 'Project display name is required.' }, cors);
      }

      const projectsCol = mongoDb.collection('projects');
      const existing = await projectsCol.findOne({ $or: [{ _id: id }, { id: id }] });
      if (existing) {
        return sendJson(res, 409, { ok: false, error: `Project with ID "${id}" already exists.` }, cors);
      }

      const format = `${id}-`;
      const newProjectDoc = {
        _id: id,
        id,
        name,
        description,
        'task-id-format': format,
        taskIdFormat: format,
        createdAt: new Date().toISOString()
      };
      await projectsCol.insertOne(newProjectDoc);

      // Seed the new project's default task types & tag registry
      try {
        await seedProjectDefaults(mongoDb, id);
      } catch (seedErr) {
        console.warn(`[Admin] Warning initializing new project "${id}":`, seedErr.message);
      }

      return sendJson(res, 201, { ok: true, project: newProjectDoc }, cors);
    }
  }

  // 3.3.3 List User Projects: GET /api/projects
  if (pathname === '/api/projects' && req.method === 'GET') {
    if (!mongoDb) {
      return sendJson(res, 403, { ok: false, error: 'Not connected to MongoDB' }, cors);
    }
    try {
      const isAdmin = req.user && Boolean(req.user.isAdmin);
      let projects;
      if (isAdmin) {
        projects = await mongoDb.collection('projects').find({}).toArray();
      } else {
        let userProjects = req.user && Array.isArray(req.user.projects) ? req.user.projects : ['project-ludum'];
        if (req.user && req.user.username) {
          const userDoc = await mongoDb.collection('users').findOne(
            { usernameLower: req.user.username.toLowerCase() },
            { projection: { projects: 1 } }
          );
          if (userDoc) {
            userProjects = Array.isArray(userDoc.projects) ? userDoc.projects : ['project-ludum'];
            req.user.projects = userProjects;
          }
        }
        if (userProjects.length === 0) {
          return sendJson(res, 200, { ok: true, projects: [] }, cors);
        }
        projects = await mongoDb.collection('projects')
          .find({ _id: { $in: userProjects } })
          .toArray();
      }

      const normalized = projects.map(p => {
        const format = p['task-id-format'] || p.taskIdFormat || (p.id === 'project-ludum' || p._id === 'project-ludum' ? 'lud-' : `${p.id || p._id}-`);
        return {
          id: p.id || p._id,
          name: p.name,
          description: p.description || '',
          'task-id-format': format,
          taskIdFormat: format
        };
      });

      if (!normalized.some(p => p.id === 'project-ludum')) {
        normalized.unshift({
          id: DEFAULT_PROJECT.id,
          name: DEFAULT_PROJECT.name,
          description: DEFAULT_PROJECT.description,
          'task-id-format': DEFAULT_PROJECT['task-id-format'],
          taskIdFormat: DEFAULT_PROJECT.taskIdFormat
        });
      }

      return sendJson(res, 200, { ok: true, projects: normalized }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Failed to list projects: ' + err.message }, cors);
    }
  }

  // 3.4 List Task Types: GET /api/task-types
  if (pathname === '/api/task-types' && req.method === 'GET') {
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, projCtx.status, { ok: false, error: projCtx.error }, cors);
    }
    try {
      const list = await mongoDb.collection('task_types')
        .find({ project: projCtx.projectId })
        .sort({ name: 1 })
        .toArray();
      const taskTypes = list.map(normalizeTaskType);
      return sendJson(res, 200, { ok: true, taskTypes, projectId: projCtx.projectId }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message }, cors);
    }
  }

  // 4. Tasks endpoints: GET / PUT / POST /api/tasks
  if (pathname === '/api/tasks') {
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, projCtx.status, { ok: false, error: projCtx.error }, cors);
    }
    const projectId = projCtx.projectId;

    if (req.method === 'GET') {
      try {
        // Parse query parameters for filtering/pagination
        const urlObj = new URL(req.url, 'http://localhost');
        const queryParams = new URLSearchParams(urlObj.search);

        const filter = { project: projectId };
        // Build MongoDB filter from query params
        if (queryParams.get('status')) filter.status = { $in: [queryParams.get('status')] };
        if (queryParams.get('priority')) filter.priority = queryParams.get('priority');
        if (queryParams.get('assignee')) filter.assignee = queryParams.get('assignee');
        if (queryParams.get('tag')) filter.tags = queryParams.get('tag');
        if (queryParams.get('type')) filter.type = queryParams.get('type');
        if (queryParams.get('parentId') !== null) {
          const pid = queryParams.get('parentId');
          filter.parentId = (pid === 'null' || pid === '') ? null : pid;
        }
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
          const copy = {
            ...t,
            id: String(id),
            type: t.type || 'task',
            parentId: t.parentId || null,
            linkedTaskIds: Array.isArray(t.linkedTaskIds) ? t.linkedTaskIds : [],
            favorite: Boolean(t.favorite)
          };
          delete copy._id;
          return copy;
        });

        // Load tag registry
        const tagDoc = await mongoDb.collection('tags').findOne({ _id: tagRegistryId(projectId) }).catch(() => null);
        const tags = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];

        // Optional search via query param (client-side filtering still possible)
        const search = queryParams.get('search');
        let finalTasks = normalized;
        if (search) {
          const term = search.toLowerCase();
          finalTasks = normalized.filter(t => {
            const text = [t.name, t.description, t['openspec-id'], t.type, ...(t.tags || [])]
              .join(' ').toLowerCase();
            return text.includes(term) || (t.attachments || []).some(a => a.filename.toLowerCase().includes(term));
          });
        }

        return sendJson(res, 200, {
          projectId,
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

      // Check if this is a single task creation via POST
      if (req.method === 'POST' && parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !Array.isArray(parsed.tasks) && (parsed.name || parsed.nombre)) {
        try {
          const now = new Date().toISOString();
          const taskName = (parsed.name || parsed.nombre).trim();
          if (!taskName) {
            return sendJson(res, 400, { ok: false, error: 'Task name is required' }, cors);
          }
          let id = parsed.id;
          if (!id) {
            const format = projCtx.project['task-id-format'] || projCtx.project.taskIdFormat || (projCtx.project.id === 'project-ludum' ? 'lud-' : `${projCtx.project.id}-`);
            id = await generateNextTaskId(mongoDb, format);
          }
          const singleDoc = {
            ...parsed,
            _id: id,
            id,
            project: projectId,
            name: taskName,
            type: parsed.type || 'task',
            parentId: parsed.parentId || null,
            linkedTaskIds: Array.isArray(parsed.linkedTaskIds) ? parsed.linkedTaskIds : [],
            status: parsed.status || 'planned',
            priority: parsed.priority || 'medium',
            favorite: Boolean(parsed.favorite),
            created_at: parsed.created_at || now,
            updated_at: parsed.updated_at || now,
            history: parsed.history || [{
              from_status: null,
              to_status: parsed.status || 'planned',
              timestamp: now,
              reason: 'Initial creation via API',
              user: req.user && req.user.username
            }],
            comments: parsed.comments || [],
            attachments: parsed.attachments || []
          };
          delete singleDoc.nombre;
          const clash = await mongoDb.collection('tasks').findOne({ _id: id, project: { $ne: projectId } }, { projection: { _id: 1 } });
          if (clash) {
            return sendJson(res, 409, { ok: false, error: `Task id "${id}" is already used by another project.` }, cors);
          }
          await mongoDb.collection('tasks').updateOne({ _id: id, project: projectId }, { $set: singleDoc }, { upsert: true });
          const normalized = { ...singleDoc };
          delete normalized._id;
          return sendJson(res, 201, { ok: true, id, task: normalized, projectId }, cors);
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: 'Failed to create task: ' + err.message }, cors);
        }
      }

      const tasksList = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null);
      if (!tasksList) {
        return sendJson(res, 400, { ok: false, error: 'JSON payload must contain an array of tasks or { tags, tasks }' }, cors);
      }

      try {
        // Save tags registry
        if (parsed && Array.isArray(parsed.tags)) {
          await mongoDb.collection('tags').updateOne(
            { _id: tagRegistryId(projectId) },
            { $set: { project: projectId, tags: parsed.tags, updatedAt: new Date() } },
            { upsert: true }
          );
        }

        const taskCol = mongoDb.collection('tasks');
        if (tasksList.length > 0) {
          const ops = tasksList.map(t => {
            const id = t.id || t._id;
            const doc = {
              ...t,
              _id: id,
              id,
              project: projectId,
              type: t.type || 'task',
              parentId: t.parentId || null,
              linkedTaskIds: Array.isArray(t.linkedTaskIds) ? t.linkedTaskIds : []
            };
            return {
              updateOne: {
                // A task id owned by another project fails instead of being overwritten
                filter: { _id: id, project: projectId },
                update: { $set: doc },
                upsert: true
              }
            };
          });
          await taskCol.bulkWrite(ops);
        }

        // Remove deleted tasks from collection
        const currentIds = tasksList.map(t => t.id || t._id);
        await taskCol.deleteMany({ project: projectId, _id: { $nin: currentIds } });

        return sendJson(res, 200, { ok: true, count: tasksList.length, projectId }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Failed to save tasks to MongoDB: ' + err.message }, cors);
      }
    }
  }

  // 5. Single Task: PUT / DELETE /api/tasks/<id>
  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, projCtx.status, { ok: false, error: projCtx.error }, cors);
    }
    const projectId = projCtx.projectId;
    const taskId = decodeURIComponent(taskMatch[1]);

    // GET method for single task
    if (req.method === 'GET') {
      try {
        const doc = await mongoDb.collection('tasks').findOne({ _id: taskId, project: projectId });
        if (!doc) {
          return sendJson(res, 404, { ok: false, error: 'Task not found' }, cors);
        }
        const id = doc.id || doc._id;
        const normalized = {
          ...doc,
          id: String(id),
          type: doc.type || 'task',
          parentId: doc.parentId || null,
          linkedTaskIds: Array.isArray(doc.linkedTaskIds) ? doc.linkedTaskIds : [],
          favorite: Boolean(doc.favorite)
        };
        delete normalized._id;
        return sendJson(res, 200, { ok: true, task: normalized, projectId }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'DELETE') {
      try {
        const descendantIds = await getAllDescendantIds(mongoDb, projectId, taskId);
        const allIdsToDelete = [taskId, ...descendantIds];
        await mongoDb.collection('tasks').deleteMany({ project: projectId, _id: { $in: allIdsToDelete } });
        await mongoDb.collection('attachments').deleteMany({ project: projectId, taskId: { $in: allIdsToDelete } });
        await mongoDb.collection('tasks').updateMany(
          { project: projectId, linkedTaskIds: { $in: allIdsToDelete } },
          { $pull: { linkedTaskIds: { $in: allIdsToDelete } } }
        );
        return sendJson(res, 200, { ok: true, deletedCount: allIdsToDelete.length, deletedIds: allIdsToDelete, projectId }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const task = JSON.parse(body.toString('utf8'));
        const now = new Date().toISOString();

        // Hierarchy validation: self-referencing check
        if (task.parentId && task.parentId === taskId) {
          return sendJson(res, 400, { ok: false, error: 'A task cannot be its own subtask' }, cors);
        }

        // Check if status changed to record history entry
        const existing = await mongoDb.collection('tasks').findOne({ _id: taskId, project: projectId });

        // Hierarchy validation: cycle and sibling checks
        if (task.parentId) {
          const descendants = await getAllDescendantIds(mongoDb, projectId, taskId);
          if (descendants.includes(task.parentId)) {
            return sendJson(res, 400, { ok: false, error: 'Cannot set parentId to a descendant task (cycle detected)' }, cors);
          }
          if (existing && existing.parentId) {
            const parentDoc = await mongoDb.collection('tasks').findOne({ _id: task.parentId, project: projectId });
            if (parentDoc && parentDoc.parentId && parentDoc.parentId === existing.parentId) {
              return sendJson(res, 400, { ok: false, error: 'Cannot assign a sibling task as a subtask' }, cors);
            }
          }
        }

        if (existing) {
          task._id = taskId;
          task.id = taskId;
          task.type = task.type || existing.type || 'task';
          task.parentId = task.parentId !== undefined ? (task.parentId || null) : (existing.parentId || null);
          task.linkedTaskIds = task.linkedTaskIds !== undefined
            ? (Array.isArray(task.linkedTaskIds) ? task.linkedTaskIds : [])
            : (Array.isArray(existing.linkedTaskIds) ? existing.linkedTaskIds : []);
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
          task.type = task.type || 'task';
          task.parentId = task.parentId || null;
          task.linkedTaskIds = Array.isArray(task.linkedTaskIds) ? task.linkedTaskIds : [];
          task.created_at = now;
          task.updated_at = now;
          if (!task.history) task.history = [];
        }

        task.project = projectId;
        await mongoDb.collection('tasks').updateOne({ _id: taskId, project: projectId }, { $set: task }, { upsert: true });
        return sendJson(res, 200, { ok: true, projectId }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  // 6. Attachment endpoints: /api/tasks/<id>/attachments
  const taskAttachmentsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/attachments\/?(.*)$/);
  if (taskAttachmentsMatch) {
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, projCtx.status, { ok: false, error: projCtx.error }, cors);
    }
    const projectId = projCtx.projectId;
    const taskId = encodeURIComponent(taskAttachmentsMatch[1]);

    if (req.method === 'GET') {
      // List attachments
      try {
        const task = await mongoDb.collection('tasks').findOne({ _id: taskId, project: projectId });
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
          { _id: taskId, project: projectId },
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
          { _id: taskId, project: projectId },
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
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, projCtx.status, { ok: false, error: projCtx.error }, cors);
    }
    const projectId = projCtx.projectId;
    const taskId = decodeURIComponent(singleAttachmentMatch[1]);
    const filename = decodeURIComponent(singleAttachmentMatch[2]);

    if (!isSafeSegment(taskId) || !isSafeSegment(filename)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid task id or filename' }, cors);
    }

    if (req.method === 'GET') {
      try {
        const task = await mongoDb.collection('tasks').findOne({ _id: taskId, project: projectId });
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
        
        // Create/update attachment object
        const attachment = {
          filename: file.filename,
          contentType: req.headers['content-type']?.includes('boundary') 
            ? (file.data.length > 0 ? 'application/octet-stream' : '')
            : 'application/octet-stream',
          size: file.data.length,
          uploadedAt: new Date().toISOString(),
          userId: req.user?.username || null
        };
        
        if (attachment.contentType === 'application/octet-stream') {
          const ext = path.extname(file.filename).toLowerCase();
          attachment.contentType = MIME_TYPES[ext] || 'application/octet-stream';
        }
        
        // First remove any existing attachment with same filename, then add new one
        await mongoDb.collection('tasks').updateOne(
          { _id: taskId, project: projectId },
          { 
            $pull: { attachments: { filename: file.filename } },
            $set: { updated_at: new Date().toISOString() }
          }
        );
        
        // Then add the new attachment
        const result = await mongoDb.collection('tasks').updateOne(
          { _id: taskId, project: projectId },
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
          { _id: taskId, project: projectId },
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
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, 200, [], cors);
    }
    const projectId = projCtx.projectId;
    try {
      const list = await mongoDb.collection('attachments')
        .find({ project: projectId }, { projection: { data: 0 } })
        .toArray();
      return sendJson(res, 200, list, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message }, cors);
    }
  }

  // Legacy single attachment: GET / PUT / DELETE /api/attachments/<taskId>/<filename>
  const attMatch = pathname.match(/^\/api\/attachments\/([^/]+)\/([^/]+)$/);
  if (attMatch) {
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, projCtx.status, { ok: false, error: projCtx.error }, cors);
    }
    const projectId = projCtx.projectId;
    const taskId = decodeURIComponent(attMatch[1]);
    const filename = decodeURIComponent(attMatch[2]);
    if (!isSafeSegment(taskId) || !isSafeSegment(filename)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid task id or filename' }, cors);
    }

    if (req.method === 'GET') {
      try {
        const doc = await mongoDb.collection('attachments').findOne({ taskId, filename, project: projectId });
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
          { taskId, filename, project: projectId },
          {
            $set: {
              taskId,
              filename,
              project: projectId,
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
        await mongoDb.collection('attachments').deleteOne({ taskId, filename, project: projectId });
        return sendJson(res, 200, { ok: true }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  // 8. Tags endpoints: GET / POST /api/tags
  if (pathname === '/api/tags') {
    const projCtx = await resolveProjectContext(req);
    if (!projCtx.ok) {
      return sendJson(res, projCtx.status, { ok: false, error: projCtx.error }, cors);
    }
    const projectId = projCtx.projectId;

    if (req.method === 'GET') {
      try {
        const tagDoc = await mongoDb.collection('tags').findOne({ _id: tagRegistryId(projectId) });
        const tags = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];
        return sendJson(res, 200, { ok: true, tags, projectId }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }

    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body.toString('utf8'));
        const tagName = (parsed.tag || parsed.name || '').trim();
        if (!tagName) {
          return sendJson(res, 400, { ok: false, error: 'Tag name is required' }, cors);
        }
        await mongoDb.collection('tags').updateOne(
          { _id: tagRegistryId(projectId) },
          { $addToSet: { tags: tagName }, $set: { project: projectId, updatedAt: new Date() } },
          { upsert: true }
        );
        return sendJson(res, 201, { ok: true, tag: tagName, projectId }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  // 9. Project Task Types Management: /api/projects/:projectId/task-types
  const taskTypeMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/task-types(?:\/([^\/]+))?$/);
  if (taskTypeMatch) {
    if (!isAdminUser(req)) {
      return sendJson(res, 403, { ok: false, error: 'Access denied. Administrative role required.' }, cors);
    }
    const projectId = decodeURIComponent(taskTypeMatch[1]);
    const typeId = taskTypeMatch[2] ? decodeURIComponent(taskTypeMatch[2]) : null;

    const projectsCol = mongoDb.collection('projects');
    let projectDoc = await projectsCol.findOne({ $or: [{ _id: projectId }, { id: projectId }] });
    if (!projectDoc && projectId === 'project-ludum') projectDoc = DEFAULT_PROJECT;
    if (!projectDoc) {
      return sendJson(res, 404, { ok: false, error: `Project "${projectId}" not found.` }, cors);
    }

    if (req.method === 'GET' && !typeId) {
      const list = await mongoDb.collection('task_types').find({ project: projectId }).sort({ name: 1 }).toArray();
      const taskTypes = list.map(normalizeTaskType);
      return sendJson(res, 200, { ok: true, taskTypes, projectId }, cors);
    }

    if (req.method === 'POST' && !typeId) {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + e.message }, cors);
      }
      const id = (parsed.id || parsed.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const name = (parsed.name || id).trim();
      const icon = (parsed.icon || 'check square outline').trim();
      const color = (parsed.color || 'blue').trim();

      if (!id || !name) {
        return sendJson(res, 400, { ok: false, error: 'Task type ID and name are required.' }, cors);
      }
      const existing = await mongoDb.collection('task_types').findOne({ _id: taskTypeDocId(projectId, id) });
      if (existing) {
        return sendJson(res, 409, { ok: false, error: `Task type "${id}" already exists in project.` }, cors);
      }
      const doc = taskTypeDoc(projectId, { id, name, icon, color });
      await mongoDb.collection('task_types').insertOne(doc);
      return sendJson(res, 201, { ok: true, taskType: doc, projectId }, cors);
    }

    if (req.method === 'PUT' && typeId) {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + e.message }, cors);
      }
      const updateData = {};
      if (parsed.name) updateData.name = parsed.name.trim();
      if (parsed.icon) updateData.icon = parsed.icon.trim();
      if (parsed.color) updateData.color = parsed.color.trim();

      const result = await mongoDb.collection('task_types').updateOne(
        { _id: taskTypeDocId(projectId, typeId) },
        { $set: updateData }
      );
      if (result.matchedCount === 0) {
        return sendJson(res, 404, { ok: false, error: `Task type "${typeId}" not found.` }, cors);
      }
      return sendJson(res, 200, { ok: true, message: `Task type "${typeId}" updated.`, projectId }, cors);
    }

    if (req.method === 'DELETE' && typeId) {
      if (typeId === 'task') {
        return sendJson(res, 400, { ok: false, error: 'The default "task" type cannot be deleted.' }, cors);
      }
      const reassignResult = await mongoDb.collection('tasks').updateMany(
        { project: projectId, type: typeId },
        { $set: { type: 'task', updated_at: new Date().toISOString() } }
      );
      await mongoDb.collection('task_types').deleteOne(
        { _id: taskTypeDocId(projectId, typeId) }
      );
      return sendJson(res, 200, {
        ok: true,
        message: `Task type "${typeId}" deleted.`,
        reassignedTasksCount: reassignResult.modifiedCount,
        projectId
      }, cors);
    }
  }

  // 10. Project Tags Management: /api/projects/:projectId/tags
  const tagMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/tags(?:\/([^\/]+))?$/);
  if (tagMatch) {
    if (!isAdminUser(req)) {
      return sendJson(res, 403, { ok: false, error: 'Access denied. Administrative role required.' }, cors);
    }
    const projectId = decodeURIComponent(tagMatch[1]);
    const tagName = tagMatch[2] ? decodeURIComponent(tagMatch[2]) : null;

    const projectsCol = mongoDb.collection('projects');
    let projectDoc = await projectsCol.findOne({ $or: [{ _id: projectId }, { id: projectId }] });
    if (!projectDoc && projectId === 'project-ludum') projectDoc = DEFAULT_PROJECT;
    if (!projectDoc) {
      return sendJson(res, 404, { ok: false, error: `Project "${projectId}" not found.` }, cors);
    }

    if (req.method === 'GET' && !tagName) {
      const tagDoc = await mongoDb.collection('tags').findOne({ _id: tagRegistryId(projectId) });
      const rawTags = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];
      const allTasks = await mongoDb.collection('tasks').find({ project: projectId }, { projection: { tags: 1 } }).toArray();
      const countMap = {};
      allTasks.forEach(t => {
        (t.tags || []).forEach(name => {
          const k = String(name).toLowerCase();
          countMap[k] = (countMap[k] || 0) + 1;
        });
      });
      const tagsWithCounts = rawTags.map(t => {
        const name = typeof t === 'string' ? t : t.name;
        const color = (t && typeof t === 'object' && t.color) ? t.color : 'grey';
        return {
          name,
          color,
          taskCount: countMap[String(name).toLowerCase()] || 0
        };
      });
      return sendJson(res, 200, { ok: true, tags: tagsWithCounts, projectId }, cors);
    }

    if (req.method === 'POST' && !tagName) {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + e.message }, cors);
      }
      const newTagName = (parsed.tag || parsed.name || '').trim();
      const color = (parsed.color || 'blue').trim();
      if (!newTagName) {
        return sendJson(res, 400, { ok: false, error: 'Tag name is required.' }, cors);
      }
      const tagDoc = await mongoDb.collection('tags').findOne({ _id: tagRegistryId(projectId) });
      const tagsList = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];
      const lower = newTagName.toLowerCase();
      if (tagsList.some(t => (typeof t === 'string' ? t : t.name).toLowerCase() === lower)) {
        return sendJson(res, 409, { ok: false, error: `Tag "${newTagName}" already exists.` }, cors);
      }
      tagsList.push({ name: newTagName, color });
      await mongoDb.collection('tags').updateOne(
        { _id: tagRegistryId(projectId) },
        { $set: { project: projectId, tags: tagsList, updatedAt: new Date() } },
        { upsert: true }
      );
      return sendJson(res, 201, { ok: true, tag: { name: newTagName, color }, projectId }, cors);
    }

    if (req.method === 'PUT' && tagName) {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON: ' + e.message }, cors);
      }
      const newName = (parsed.newName || parsed.name || '').trim();
      const color = parsed.color ? parsed.color.trim() : null;
      if (!newName) {
        return sendJson(res, 400, { ok: false, error: 'New tag name is required.' }, cors);
      }

      const taskUpdate = await mongoDb.collection('tasks').updateMany(
        { project: projectId, tags: tagName },
        { $set: { "tags.$[elem]": newName, updated_at: new Date().toISOString() } },
        { arrayFilters: [{ "elem": tagName }] }
      );

      const tagDoc = await mongoDb.collection('tags').findOne({ _id: tagRegistryId(projectId) });
      let tagsList = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];
      tagsList = tagsList.map(t => {
        const curName = typeof t === 'string' ? t : t.name;
        if (curName.toLowerCase() === tagName.toLowerCase()) {
          return { name: newName, color: color || (typeof t === 'object' && t.color ? t.color : 'blue') };
        }
        return typeof t === 'string' ? { name: t, color: 'grey' } : t;
      });
      await mongoDb.collection('tags').updateOne(
        { _id: tagRegistryId(projectId) },
        { $set: { project: projectId, tags: tagsList, updatedAt: new Date() } },
        { upsert: true }
      );

      return sendJson(res, 200, {
        ok: true,
        message: `Tag "${tagName}" renamed to "${newName}".`,
        updatedTasksCount: taskUpdate.modifiedCount,
        projectId
      }, cors);
    }

    if (req.method === 'DELETE' && tagName) {
      const taskUpdate = await mongoDb.collection('tasks').updateMany(
        { project: projectId, tags: tagName },
        { $pull: { tags: tagName }, $set: { updated_at: new Date().toISOString() } }
      );

      const tagDoc = await mongoDb.collection('tags').findOne({ _id: tagRegistryId(projectId) });
      let tagsList = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];
      tagsList = tagsList.filter(t => {
        const curName = typeof t === 'string' ? t : t.name;
        return curName.toLowerCase() !== tagName.toLowerCase();
      });
      await mongoDb.collection('tags').updateOne(
        { _id: tagRegistryId(projectId) },
        { $set: { project: projectId, tags: tagsList, updatedAt: new Date() } },
        { upsert: true }
      );

      return sendJson(res, 200, {
        ok: true,
        message: `Tag "${tagName}" deleted and removed from tasks.`,
        affectedTasksCount: taskUpdate.modifiedCount,
        projectId
      }, cors);
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

if (require.main === module) {
  main();
} else {
  module.exports = {
    createServer,
    connectMongo,
    disconnectMongo,
    hashPassword,
    verifyPassword
  };
}