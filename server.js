#!/usr/bin/env node

/**
 * Lightweight zero-dependency HTTP server for vg-task-manager (standard Node.js only).
 * Serves the task manager board on the first available port from 8766,
 * opens the browser automatically, and enables direct 2-way sync with tasks.json.
 *
 * Stop with Ctrl+C.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');

const APP_DIR = __dirname;
const TASKS_FILE = path.join(APP_DIR, 'tasks.json');
const INDEX_FILE = path.join(APP_DIR, 'index.html');

const FIRST_PORT = 8766;
const MAX_ATTEMPTS = 20;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
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

function createServer() {
  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // Save tasks (POST /tasks.json)
    if (req.method === 'POST' && pathname === '/tasks.json') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
        }
      });

      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!Array.isArray(parsed) && !Array.isArray(parsed.tasks)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'JSON must be an array of tasks or an object with a tasks array' }));
          }

          fs.writeFileSync(TASKS_FILE, JSON.stringify(parsed, null, 2), 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ ok: true, count: Array.isArray(parsed) ? parsed.length : parsed.tasks.length }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON: ' + err.message }));
        }
      });
      return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method Not Allowed');
    }

    // Static files
    let targetFile;
    if (pathname === '/' || pathname === '/index.html') {
      targetFile = INDEX_FILE;
    } else if (pathname === '/tasks.json') {
      targetFile = TASKS_FILE;
    } else {
      targetFile = path.join(APP_DIR, pathname.replace(/^\/+/, ''));
    }

    const safeTarget = path.normalize(targetFile);
    if (!safeTarget.startsWith(APP_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }

    fs.stat(safeTarget, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 Not Found');
      }

      const ext = path.extname(safeTarget).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });

      if (req.method === 'HEAD') return res.end();

      const stream = fs.createReadStream(safeTarget);
      stream.on('error', streamErr => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Error reading file: ' + streamErr.message);
      });
      stream.pipe(res);
    });
  });
}

async function main() {
  try {
    const port = await findAvailablePort(FIRST_PORT, MAX_ATTEMPTS);
    const server = createServer();

    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`;
      console.log(`\nvg-task-manager running: ${url}  (Press Ctrl+C to stop)\n`);
      openBrowser(url);
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
