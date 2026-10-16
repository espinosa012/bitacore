#!/usr/bin/env node

/**
 * Lightweight zero-dependency HTTP server for vg-task-manager (standard Node.js only).
 * Serves the task manager board on the first available port from 8766,
 * opens the browser automatically, and acts as a local sync agent so that
 * any browser (Safari, Firefox, Chrome...) can read and write a folder on disk:
 *
 *   <sync-dir>/tasks.json
 *   <sync-dir>/attachments/<taskId>/<filename>
 *
 * Usage:
 *   node server.js [sync-dir]        (default: the app directory)
 *
 * Environment:
 *   VG_PORT             first port to try (default 8766)
 *   VG_ALLOWED_ORIGINS  extra comma-separated origins allowed to use the sync API
 *   VG_NO_OPEN=1        do not open the browser automatically
 *
 * Stop with Ctrl+C.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');

const APP_DIR = __dirname;
const SYNC_DIR = path.resolve(process.argv[2] || APP_DIR);
const TASKS_FILE = path.join(SYNC_DIR, 'tasks.json');
const ATTACHMENTS_DIR = path.join(SYNC_DIR, 'attachments');
const INDEX_FILE = path.join(APP_DIR, 'index.html');

const FIRST_PORT = parseInt(process.env.VG_PORT, 10) || 8766;
const MAX_ATTEMPTS = 20;
const MAX_BODY = 200 * 1024 * 1024;

// Origins allowed to call the sync API cross-origin (e.g. the GitHub Pages build).
// Same-origin requests (page served by this server) are always allowed.
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

/** CORS headers for an allowed origin, or null if the origin is not allowed. */
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (!ALLOWED_ORIGINS.has(origin) && !isLoopbackOrigin(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Chrome Private Network Access: public site -> localhost
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

/** A single path segment: no separators, no traversal, no hidden files. */
function isSafeSegment(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 &&
    !name.includes('/') && !name.includes('\\') && !name.includes('\0') &&
    name !== '.' && name !== '..';
}

function listAttachments() {
  const result = [];
  if (!fs.existsSync(ATTACHMENTS_DIR)) return result;
  for (const taskEntry of fs.readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })) {
    if (!taskEntry.isDirectory()) continue;
    const taskDir = path.join(ATTACHMENTS_DIR, taskEntry.name);
    for (const fileEntry of fs.readdirSync(taskDir, { withFileTypes: true })) {
      if (!fileEntry.isFile() || fileEntry.name.startsWith('.')) continue;
      const stats = fs.statSync(path.join(taskDir, fileEntry.name));
      result.push({ taskId: taskEntry.name, filename: fileEntry.name, size: stats.size });
    }
  }
  return result;
}

function validateTasksPayload(parsed) {
  return Array.isArray(parsed) || (parsed && Array.isArray(parsed.tasks));
}

async function handleApi(req, res, pathname, cors) {
  // GET /api/status
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: 'vg-task-manager',
      dirName: path.basename(SYNC_DIR),
      dirPath: SYNC_DIR,
      hasTasks: fs.existsSync(TASKS_FILE)
    }, cors);
  }

  // GET / PUT /api/tasks
  if (pathname === '/api/tasks') {
    if (req.method === 'GET') {
      if (!fs.existsSync(TASKS_FILE)) {
        return sendJson(res, 404, { error: `No tasks.json in ${SYNC_DIR}` }, cors);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
      return res.end(fs.readFileSync(TASKS_FILE));
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (err) {
        return sendJson(res, 400, { error: 'Invalid JSON: ' + err.message }, cors);
      }
      if (!validateTasksPayload(parsed)) {
        return sendJson(res, 400, { error: 'JSON must be an array of tasks or an object with a tasks array' }, cors);
      }
      fs.mkdirSync(SYNC_DIR, { recursive: true });
      const tmp = TASKS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2), 'utf8');
      fs.renameSync(tmp, TASKS_FILE);
      return sendJson(res, 200, { ok: true, count: Array.isArray(parsed) ? parsed.length : parsed.tasks.length }, cors);
    }
  }

  // GET /api/attachments
  if (pathname === '/api/attachments' && req.method === 'GET') {
    return sendJson(res, 200, listAttachments(), cors);
  }

  // GET / PUT / DELETE /api/attachments/<taskId>/<filename>
  const match = pathname.match(/^\/api\/attachments\/([^/]+)\/([^/]+)$/);
  if (match) {
    const taskId = decodeURIComponent(match[1]);
    const filename = decodeURIComponent(match[2]);
    if (!isSafeSegment(taskId) || !isSafeSegment(filename)) {
      return sendJson(res, 400, { error: 'Invalid task id or filename' }, cors);
    }
    const taskDir = path.join(ATTACHMENTS_DIR, taskId);
    const filePath = path.join(taskDir, filename);

    if (req.method === 'GET') {
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'Not found' }, cors);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', ...cors });
      return fs.createReadStream(filePath).pipe(res);
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      fs.mkdirSync(taskDir, { recursive: true });
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, filePath);
      return sendJson(res, 200, { ok: true, size: body.length }, cors);
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      try {
        if (fs.readdirSync(taskDir).length === 0) fs.rmdirSync(taskDir);
      } catch (e) { /* ignore */ }
      return sendJson(res, 200, { ok: true }, cors);
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
    fs.mkdirSync(SYNC_DIR, { recursive: true });
    const port = await findAvailablePort(FIRST_PORT, MAX_ATTEMPTS);
    const server = createServer();

    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`;
      console.log(`\nvg-task-manager running: ${url}  (Press Ctrl+C to stop)`);
      console.log(`Sync folder: ${SYNC_DIR}\n`);
      if (port !== 8766) {
        console.log(`Note: GitHub Pages looks for the agent on port 8766; use ${url} directly.\n`);
      }
      if (!process.env.VG_NO_OPEN) openBrowser(url);
    });

    const shutdown = () => {
      console.log('\nStopping vg-task-manager...');
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
