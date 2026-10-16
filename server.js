#!/usr/bin/env node

/**
 * vg-task-manager: HTTP Server & MongoDB Atlas Sync Backend
 * Serves the web UI and provides API endpoints for:
 *   - Connecting to MongoDB Atlas (vg-task-manager database, tasks and attachments collections)
 *   - Querying, creating, updating, and deleting tasks
 *   - Storing, streaming, and deleting attachment files in MongoDB
 *
 * Usage:
 *   node server.js [mongo-uri]
 *
 * Environment:
 *   VG_PORT             first port to try (default 8766)
 *   VG_MONGO_URI        MongoDB Atlas connection string (optional default)
 *   VG_ALLOWED_ORIGINS  extra comma-separated origins allowed for CORS
 *   VG_NO_OPEN=1        do not open the browser automatically
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true'
    };
  }
  if (!ALLOWED_ORIGINS.has(origin) && !isLoopbackOrigin(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

  // 3. Disconnect from MongoDB: POST /api/mongo/disconnect
  if (pathname === '/api/mongo/disconnect' && req.method === 'POST') {
    await disconnectMongo();
    return sendJson(res, 200, { ok: true, connected: false }, cors);
  }

  // 3.1 Register User: POST /api/auth/register
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
      const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existing = await usersCol.findOne({
        $or: [
          { usernameLower: lower },
          { username: { $regex: new RegExp(`^${escaped}$`, 'i') } }
        ]
      });
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
      return sendJson(res, 201, {
        ok: true,
        user: { username, createdAt: userDoc.createdAt }
      }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Failed to register user: ' + err.message }, cors);
    }
  }

  // 3.2 Login User: POST /api/auth/login
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
      const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const userDoc = await usersCol.findOne({
        $or: [
          { usernameLower: lower },
          { username: { $regex: new RegExp(`^${escaped}$`, 'i') } }
        ]
      });
      if (!userDoc || !verifyPassword(password, userDoc.password)) {
        return sendJson(res, 401, { ok: false, error: 'Invalid username or password.' }, cors);
      }

      return sendJson(res, 200, {
        ok: true,
        user: { username: userDoc.username, createdAt: userDoc.createdAt }
      }, cors);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'Failed to authenticate: ' + err.message }, cors);
    }
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
        const rawTasks = await mongoDb.collection('tasks').find({}).toArray();
        const normalized = rawTasks.map(t => {
          const id = t.id || t._id;
          const copy = { ...t, id: String(id) };
          delete copy._id;
          return copy;
        });

        // Load tag registry if stored in 'tags' collection
        const tagDoc = await mongoDb.collection('tags').findOne({ _id: 'registry' }).catch(() => null);
        const tags = tagDoc && Array.isArray(tagDoc.tags) ? tagDoc.tags : [];

        return sendJson(res, 200, { tags, tasks: normalized }, cors);
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

    if (req.method === 'DELETE') {
      try {
        await mongoDb.collection('tasks').deleteOne({ _id: taskId });
        // Also remove any attachments for this task
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
        const doc = { ...task, _id: taskId, id: taskId };
        await mongoDb.collection('tasks').updateOne({ _id: taskId }, { $set: doc }, { upsert: true });
        return sendJson(res, 200, { ok: true }, cors);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, cors);
      }
    }
  }

  // 6. List attachments: GET /api/attachments
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

  // 7. Single attachment: GET / PUT / DELETE /api/attachments/<taskId>/<filename>
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
