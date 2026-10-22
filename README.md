# bitacore API

This project is a task manager web application that provides both a web UI and a REST API.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   node server.js
   ```

3. **Connect to MongoDB:**
   - Use the web UI to connect to your MongoDB Atlas instance
   - Or start with: `node server.js mongodb://username:password@cluster-url/database`

## API Documentation

The REST API is available at `http://localhost:<port>/api/` (replace `<port>` with the port number shown in the console output).

All API endpoints (except `/api/auth/*` and `/api/status`) require a valid JWT token in the `Authorization: Bearer <token>` header.

You can obtain a token by registering or logging in via:
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Log in with username/password

## Key Features

### Authentication
- JWT tokens with 24-hour expiration
- Static secret key (configurable via `API_JWT_SECRET` environment variable)
- User registration and login

### Task Management
- Create, read, update, delete tasks
- Server-side filtering: search, status, priority, tag, assignee
- Pagination with limit/offset
- Task history tracking

### Attachment Management
- Upload files to tasks via multipart/form-data
- List, download, and delete attachments
- In-memory storage within MongoDB

### User & Tag Management
- List all users (admin functionality)
- List and create tags

### Status & Monitoring
- Check server status and MongoDB connection
- View database statistics

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Log in with username/password |
| POST | `/api/auth/logout` | Log out (client-side token invalidation) |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users (admin only) |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List all tasks (paginated) |
| POST | `/api/tasks` | Create a new task |
| GET | `/api/tasks/{id}` | Get task by ID |
| PUT | `/api/tasks/{id}` | Update task |
| DELETE | `/api/tasks/{id}` | Delete task and its attachments |

### Attachments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks/{id}/attachments` | List attachments for a task |
| POST | `/api/tasks/{id}/attachments` | Upload attachment file |
| DELETE | `/api/tasks/{id}/attachments/{filename}` | Delete single attachment |
| DELETE | `/api/tasks/{id}/attachments` | Delete all attachments for a task |

### Tags
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Add new tag |

### Status
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Server status and MongoDB connection info |

## Error Handling

All error responses follow the same pattern:
```json
{
  "ok": false,
  "error": "error message"
}
```

HTTP status codes:
- `200`: Success
- `201`: Created
- `400`: Bad request / validation error
- `401`: Unauthorized (missing or invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not found
- `409`: Conflict (e.g., duplicate username)
- `500`: Internal server error

## Database Schema

The application uses MongoDB Atlas with:

- **Database**: `vg-task-manager`
- **Collections**:
  - `tasks`: Main task data
  - `users`: User accounts (passwords are hashed)
  - `attachments`: Legacy attachment collection (still used for compatibility)

### Task Document Structure
```json
{
  "_id": "task-id",
  "id": "task-id",
  "name": "Task name",
  "description": "Task description",
  "status": "todo|in_progress|done",
  "priority": "low|medium|high",
  "assignee": "username-or-null",
  "tags": ["tag1", "tag2"],
  "attachments": [
    {
      "filename": "file.txt",
      "contentType": "text/plain",
      "size": 123,
      "uploadedAt": "2026-10-17T...",
      "userId": "username"
    }
  ],
  "history": [
    {
      "from_status": "todo",
      "to_status": "in_progress",
      "timestamp": "2026-10-17T...",
      "reason": "Status changed via API",
      "user": "username"
    }
  ],
  "created_at": "2026-10-17T...",
  "updated_at": "2026-10-17T..."
}
```

### User Document Structure
```json
{
  "username": "user123",
  "usernameLower": "user123",
  "password": "salt:hash",
  "createdAt": "2026-10-17T..."
}
```

## Security Considerations

- All API endpoints except `/api/auth/*` and `/api/status` require authentication
- Tokens expire after 24 hours
- Input validation is performed server-side
- Passwords are hashed using scrypt (compatible with PBKDF2 from web UI)
- CORS restrictions apply by default; configure `VG_ALLOWED_ORIGINS` environment variable to allow cross-origin requests

## Environment Variables

- `VG_PORT`: Port to run the server on (default: 8766)
- `VG_MONGO_URI`: MongoDB Atlas connection string (optional; can be provided via web UI)
- `VG_ALLOWED_ORIGINS`: Comma-separated list of allowed origins for CORS
- `VG_NO_OPEN`: Set to any value to disable automatic browser opening
- `API_JWT_SECRET`: Override the JWT signing secret (default: `vg-task-manager-secret-key-change-me-in-production`)

## Development

- The API is designed to mirror the web UI's capabilities exactly
- No breaking changes to existing behavior
- JWT authentication is stateless (tokens are validated server-side)
- File uploads are stored in-memory within MongoDB task documents

## Testing

The API supports server-side filtering:
- `?search=...`: Search in task names, descriptions, and attachment filenames
- `?status=...`: Filter by task status
- `?priority=...`: Filter by task priority
- `?tag=...`: Filter by tag
- `?assignee=...`: Filter by assignee
- `?limit=...`: Number of results to return
- `?offset=...`: Number of results to skip (for pagination)

## License

MIT License
