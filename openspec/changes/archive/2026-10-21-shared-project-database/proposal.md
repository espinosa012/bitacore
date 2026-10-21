# Proposal

## Why

One MongoDB database per project made every project switch reconnect to a different database, duplicated task types and tag registries across databases, and made cross-project administration awkward. Projects should share one database and tell their data apart by a field.

## What Changes

- **Shared database**: All projects live in `vg-task-manager`. Each task has a hidden `project` field set to the active project when it is created.
- **Per-project task types and tags in shared collections**: Task types use `_id` `<projectId>:<typeId>` with a `project` field; the tag registry is the `tags` document `registry:<projectId>`.
- **Project selector**: Switching projects changes the active project id instead of the active database and reloads that project's tasks, tags and task types.
- **Safe writes**: Saves, deletes and cascades filter by `project`, so one project's board can never delete or overwrite another project's tasks.
- **Projects lose `dbName`**: Project creation no longer asks for a database name.
- **Migration**: On connect, legacy data is moved to the new layout (see the projects spec).

## Capabilities

### Modified Capabilities
- `projects`: Shared database with project-scoped documents replaces database-per-project isolation.
- `api`: Endpoints scope queries by the `project` field of the resolved project.

## Impact

- **Frontend**: `js/mongo-sync.js` tracks the active project and runs the migration; `js/app.js`, `js/admin.js`, `js/modals.js`, `js/task-page.js`, `js/validation.js`, `js/attachments.js` and `index.html` follow.
- **Backend API**: `server.js` uses the shared database for every project and runs the same migration on connect.
