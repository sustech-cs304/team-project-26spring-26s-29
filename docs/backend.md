# Backend

This document focuses on the Python backend: its packages, public API surface, persistence model, and agent integration points.

## Directory Layout

```text
backend/
  app.py
  config.py
  api/
    app.py
    routes/
    schemas/
    websocket.py
  agent/
    instructions.py
    runtime.py
    context/
    tools/
  services/
  repositories/
    tinydb/
  db/
```

## Responsibilities By Area

- `backend/app.py`
  Stable ASGI entry point used by `uvicorn`.

- `backend/config.py`
  In-memory runtime config store for `dbPath`, `openaiApiKey`, `openaiChatModel`, and `openaiEndpoint`.

- `backend/api/`
  FastAPI app factory, routes, request models, response models, and WebSocket helpers.

- `backend/agent/`
  Agent session lifecycle, prompt instructions, tool definitions, and runtime context providers.

- `backend/services/`
  Business-layer entry points. Today this mostly centers on Todo operations and Todo summaries.

- `backend/repositories/`
  Repository contracts plus TinyDB-backed implementations.

- `backend/db/`
  Legacy-style helper module still present in the repo. Current API and service flows use `repositories` directly.

## Public API Surface

The backend currently exposes three groups of endpoints.

### Health And Runtime Config

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check used by Electron startup |
| `GET` | `/api/config` | Read backend runtime config |
| `POST` | `/api/config` | Replace backend runtime config in memory |

`POST /api/config` does not edit `config.json` directly. Electron remains the owner of the file on disk.

### Todo API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/todos` | List all todo items |
| `GET` | `/api/todos/{todo_id}` | Read one todo item |
| `POST` | `/api/todos` | Create a todo |
| `PATCH` | `/api/todos/{todo_id}` | Update one or more fields |
| `DELETE` | `/api/todos/{todo_id}` | Delete one todo |
| `DELETE` | `/api/todos?scope=all` | Clear all todos |
| `DELETE` | `/api/todos?scope=completed` | Clear completed todos only |

Todo validation lives in `backend/api/schemas/todo.py`.

Key validation rules:

- `title` is required for create
- blank titles are rejected
- `dueAt` must be an ISO 8601 datetime string or `null`
- `PATCH` must provide at least one field
- explicit `null` is rejected for `title`, `detail`, and `isDone`

### Agent API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/agent/run` | One-shot agent response with structured message contents |
| `WS` | `/api/agent/run` | Bidirectional streamed agent session used by Electron |

The desktop app uses the WebSocket path so chat output, approval requests, and resumed tool runs can all flow through one session.

## Todo Data Model

The backend exposes Todo items with these fields:

| Field | Meaning |
| --- | --- |
| `id` | TinyDB document id |
| `title` | Required short task title |
| `detail` | Optional longer notes |
| `dueAt` | Optional ISO datetime string |
| `isDone` | Completion state |
| `completedAt` | Completion timestamp or `null` |
| `createdAt` | Creation timestamp |
| `updatedAt` | Last update timestamp |

The repository implementation stores timestamps in UTC ISO format.

## Service Layer

The main service objects are:

- `todo_service`
  CRUD-style mutations and list/get behavior

- `todo_query_service`
  Read-oriented summaries for runtime context, including counts such as open, done, overdue, and due today

This separation keeps write operations and agent-facing summaries from drifting into route handlers.

## Repository Layer

`backend/repositories/` defines contracts and default TinyDB adapters:

- `TodoRepository` / `TinyDbTodoRepository`
- `ScheduleRepository` / `TinyDbScheduleRepository`

Current production path:

```text
FastAPI route
  -> todo_service
  -> TinyDbTodoRepository
  -> TinyDB
```

The schedule repository is already implemented and tested, but it is not yet wired into the UI or public API.

## Agent Runtime

`backend/agent/runtime.py` owns the current chat runtime.

Important behaviors:

- reads runtime config from `backend/config.py`
- rebuilds the OpenAI-compatible client when model settings change
- reuses a session while the backend process stays alive
- streams structured assistant message snapshots
- pauses and resumes the same run when a tool approval is required

### Current tool surface

The current registered todo tools are:

- `list_todos`
- `create_todo`
- `update_todo`
- `delete_todo`

`list_todos` runs without approval. The write tools require explicit approval before execution.

### Current context providers

`CurrentInfoProvider` injects a short runtime summary before each run, including:

- local time metadata
- current session id
- todo counts and upcoming items when available

That gives the model lightweight awareness of the user's current todo state before it decides whether to call a tool.

## Persistence Details

TinyDB path resolution is handled in `backend/repositories/tinydb/storage.py`:

- use explicit `db_path` when passed
- otherwise read `dbPath` from runtime config
- otherwise fall back to `db.json` in the current working directory

The current tables are:

- `todo_list`
- `schedule_events`

## Tests

Backend tests live under `tests/backend_suite/` and cover:

- todo route behavior
- config route behavior
- todo service behavior
- TinyDB repository round trips
- agent tool behavior
- agent context provider behavior

Run them with:

```powershell
python -m unittest discover -s tests -v
```
