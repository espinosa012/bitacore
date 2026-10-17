# Tasks

## Implementation Tasks

### Core: JWT Authentication Middleware

- [x] Add `jsonwebtoken` to `dependencies` in `package.json`
- [x] Create `auth.js` module with:
  - `createJWT(username, secret)` - returns token with 24h expiry
  - `verifyJWT(token, secret)` - returns username or null
- [x] Add `API_JWT_SECRET` environment variable
- [x] Add JWT validation middleware:
  - Skip validation for `/api/auth/*` and `/api/status` endpoints
  - Verify `Authorization: Bearer <token>` header
  - Set `req.user = { username }` on valid requests
  - Return 401 on invalid/missing tokens
- [x] Modify `/api/auth/login` route to return token in response
- [x] Add token validation to all other protected routes (`/api/tasks/*`, `/api/users`, `/api/tags`, `/api/tasks/{id}/attachments/*`)

### API Endpoints

- [x] Implement `/api/auth/login` (POST) - already exists but needs token response
- [x] Implement `/api/auth/register` (POST) - already exists but needs token response
- [x] Add `/api/auth/logout` (POST) - invalidate token client-side
- [x] Add `/api/tasks` (GET) - list all tasks with pagination
- [x] Add `/api/tasks` (POST) - create new task
- [x] Add `/api/tasks/{id}` (GET) - get single task
- [x] Add `/api/tasks/{id}` (PUT) - update task fields (name, description, status, assignee, tags)
- [x] Add `/api/tasks/{id}` (DELETE) - remove task and attachments
- [x] Add `/api/tasks/{id}/attachments` (POST) - upload file to task
- [x] Add `/api/tasks/{id}/attachments` (GET) - list attachments for task
- [x] Add `/api/tasks/{id}/attachments/{filename}` (DELETE) - delete single attachment
- [x] Add `/api/tasks/{id}/attachments` (DELETE) - delete all attachments for task
- [x] Add `/api/tags` (GET) - list all tags
- [x] Add `/api/tags` (POST) - create new tag

### Auth Integration

- [x] Ensure `/api/auth/register` returns user object with `username` field
- [x] Ensure `/api/auth/login` returns token in response
- [x] Ensure `/api/auth/logout` invalidates token (client-side only)

### Attachment Handling

- [x] Implement file upload in `/api/tasks/{id}/attachments` using manual multipart parsing
- [x] Store attachment metadata in MongoDB task document
- [x] Upload file to MongoDB (in-memory buffer in task.attachments array)
- [x] Update task attachment array on successful upload
- [x] Add proper error handling for file upload failures

### User Management

- [x] Add `/api/users` (GET) endpoint to list all users
- [x] Ensure response includes only `username` field (no password)
- [x] Add pagination support (limit/offset)

### Security & Validation

- [x] Validate all incoming request bodies against OpenAPI schema
- [x] Add rate limiting for auth endpoints
- [x] Add input validation for task fields (name required, priority status, etc.)
- [x] Add error handling for invalid tokens and expired sessions

### Documentation

- [x] Write OpenAPI 3.0 specification in YAML format
- [x] Generate Swagger UI documentation
- [x] Update README with API usage examples

## Dependencies

- `mongodb` (already exists)
- `jsonwebtoken` (new)

## Testing Strategy

1. **Unit Tests**: 
   - Test JWT middleware with valid/invalid tokens
   - Test auth endpoint responses
   - Test route validation

2. **Integration Tests**:
   - Test auth flow (register → login → protected endpoint)
   - Test task CRUD flow (create → read → update → delete)
   - Test attachment upload/download flow

3. **Manual Testing**:
   - Verify web UI still works after API changes
   - Test token expiration (24h)
   - Test edge cases (invalid tokens, missing fields, large payloads)

## Timeline Estimate

- Core JWT middleware + auth endpoints: 1-2 days
- Task CRUD endpoints: 2-3 days
- Attachment handling: 1-2 days
- Tag management: 1 day
- Documentation: 1 day
- Testing & refinement: 1-2 days

## Risks & Mitigations

- **Risk**: JWT token leakage or misconfiguration
  - *Mitigation*: Keep secret in env var, never hardcode in source, use HTTPS in production

- **Risk**: API becomes secondary to web UI
  - *Mitigation*: API is designed to mirror web UI exactly, no breaking changes to existing behavior

- **Risk**: MongoDB connection pool exhaustion
  - *Mitigation*: Connection pooling is already handled by MongoDB driver; monitor usage

- **Risk**: Attachment uploads consume significant bandwidth
  - *Mitigation*: Use streaming uploads, validate file size before processing