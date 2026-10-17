# Design

## Architecture

```
+-------------------------------------------------------+
|                     CLIENT REQUESTS                    |
+----------------+------------------+--------------------+
                 |  Web UI (browser)|  API Client       |
                 +--------+---------+--------+----------+
                          |                   |
                          | HTTP/REST         |
                          | with JWT            |
                          v                   v
+-------------------------------------------------------+
|                    server.js (Node.js)               |
+-------------------------------------------------------+
|                                                      |
|  +--------------------+    +-----------------------+  |
|  | Auth Middleware  |----->| route handler        |-- |
|  | (verify token)    |    | /api/*                |  |
|  +--------------------+    +-----------------------+  |
|         |                         |                    |
|         v                         v                    |
|  +--------------------------------------------------+  |
|  |            MongoDB Atlas (vg-task-manager db)     |  |
|  |                                                  |  |
|  |   collections: tasks, users, tags, attachments   |  |
|  +--------------------------------------------------+  |
+-------------------------------------------------------+

Legend:
- Solid lines: direct HTTP requests
- Dashed lines: token flow (Authorization header)
```

## Authentication Flow

```
+----------+     POST /api/auth/register or login    +-------------+
|   CLIENT | -----------------------------------------> | server.js   |
+----------+                                            +-------------+
      ^                                                       |
      | 201 / 200 - { "token": "jwt" }                      |
      +---------------------------------------------------+

                (on subsequent requests)

+----------+     GET/POST/PUT/DELETE                    +-------------+
|   CLIENT | -----------------------------------------> | server.js   |
|          |    Authorization: Bearer eyJ...          |             |
+----------+                                            |             |
          |                                             +-------------+
          | 200/401/403
          v
   (data response or error)
```

## Key Implementation Decisions

### 1. JWT Library

Use `jsonwebtoken` package for sign/verify. No native scrypt over native crypto.

### 2. Static Secret (Dev-Friendly)

- Secret lives in `process.env.API_JWT_SECRET`
- Default: `'vg-task-manager-secret-key-change-me-in-production'`
- No rotating keys; simple HMAC-based JWT.

### 3. Token Payload

```json
{
  "username": "adrian",
  "iat": 1700000000,
  "exp": 17000086400
}
```

Claims:
- `username`: serves as the subject/identity
- No `userId` since usernames are unique

### 4. Middleware Placement

```
createServer()
  |
  +-- http.createServer(authMiddleware, requestHandler)

authMiddleware(req, res, next) {
  if (pathname is /api/auth/* or /api/status) next()
  else if Authorization header present with Bearer token
         verify token and set req.user = { username }
         next()
  else return 401
}
```

### 5. Passwords & Hashing Reused

Existing `hashPassword` (scrypt) and `verifyPassword` (scrypt+PBKDF2) in `server.js` handle both the web UI's PBKDF2 hashes and legacy scrypt hashes. No change needed for API registration/login.

### 6. Attachments via Multipart

API uploads attachments using `multipart/form-data`. Backend extracts file stream directly into MongoDB GridFS, matching the current web app behavior via vg-mongo-proxy.

### 7. Task Normalization

Server normalizes tasks like the web UI:
- `id` length & characters validated
- `name` required
- `tags` auto-created in tag registry if missing
- `history` array updated on status changes

### 8. Non-Breaking

- Adding auth middleware doesn't affect existing routes
- New routes can coexist with optional web UI usage
- If web UI still uses proxy for some reason, token-based API is independent

## API Client Integration Notes

A simple JS client example:

```js
const API = {
  base: 'http://localhost:8766',
  token: null,
  async login(username, password) {
    const r = await fetch(this.base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const d = await r.json();
    if (r.ok) this.token = d.token;
    return d;
  },
  async request(path, opts = {}) {
    const h = opts.headers = opts.headers || {};
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return fetch(this.base + path, opts);
  }
};
```

## Testing Considerations

- Unit tests: verify JWT middleware rejects invalid/expired tokens
- Unit tests: verify middleware passes through auth endpoints
- Integration: task CRUD via API produces visible tasks in web UI (both use same DB)