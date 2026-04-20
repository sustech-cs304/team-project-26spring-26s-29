# Backend

This document focuses on the Python backend: its packages, public API surface, persistence model, and agent integration points.

## Directory Layout

```text
backend/
  app.py
  config.py
  api/
    __init__.py
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
```

## Responsibilities By Area

- `backend/app.py`
  Stable ASGI entry point used by `uvicorn`.

- `backend/config.py`
  In-memory runtime config store for derived `dbPath`, derived `workspacePath`, and the OpenAI runtime settings.

- `backend/api/`
  FastAPI route modules, request models, response models, and WebSocket helpers.

- `backend/agent/`
  Agent session lifecycle, prompt instructions, tool definitions, and runtime context providers.

- `backend/services/`
  Business-layer entry points for Todo, Schedule, workspace file operations, and workspace command execution.

- `backend/repositories/`
  Repository contracts plus TinyDB-backed implementations.

## Public API Surface

The backend currently exposes four groups of endpoints.

### Health And Runtime Config

| Method | Path          | Purpose                                  |
| ------ | ------------- | ---------------------------------------- |
| `GET`  | `/health`     | Liveness check used by Electron startup  |
| `GET`  | `/api/config` | Read backend runtime config              |
| `POST` | `/api/config` | Replace backend runtime config in memory |

`POST /api/config` does not edit `config.json` directly. Electron remains the owner of the file on disk.

### Todo API

| Method   | Path                         | Purpose                    |
| -------- | ---------------------------- | -------------------------- |
| `GET`    | `/api/todos`                 | List all todo items        |
| `GET`    | `/api/todos/{todo_id}`       | Read one todo item         |
| `POST`   | `/api/todos`                 | Create a todo              |
| `PATCH`  | `/api/todos/{todo_id}`       | Update one or more fields  |
| `DELETE` | `/api/todos/{todo_id}`       | Delete one todo            |
| `DELETE` | `/api/todos?scope=all`       | Clear all todos            |
| `DELETE` | `/api/todos?scope=completed` | Clear completed todos only |

Todo validation lives in `backend/api/schemas/todo.py`.

Key validation rules:

- `title` is required for create
- blank titles are rejected
- `dueAt` must be an ISO 8601 datetime string or `null`
- `PATCH` must provide at least one field
- explicit `null` is rejected for `title`, `detail`, and `isDone`

### Schedule API

| Method   | Path                                     | Purpose                               |
| -------- | ---------------------------------------- | ------------------------------------- |
| `GET`    | `/api/schedules/range?start=...&end=...` | List events overlapping a time window |
| `POST`   | `/api/schedules`                         | Create a schedule event               |
| `PATCH`  | `/api/schedules/{event_id}`              | Update one or more fields             |
| `DELETE` | `/api/schedules/{event_id}`              | Delete one schedule event             |

Schedule validation and serialization live in `backend/api/schemas/schedule.py`.

The shipped Schedule HTTP surface is intentionally range-first: the renderer reads events through `/api/schedules/range` and mutates individual records with create, patch, and delete operations.

### Agent API

| Method | Path             | Purpose                                                  |
| ------ | ---------------- | -------------------------------------------------------- |
| `POST` | `/api/agent/run` | One-shot agent response with structured message contents |
| `WS`   | `/api/agent/run` | Bidirectional streamed agent session used by Electron    |

The desktop app uses the WebSocket path so chat output, approval requests, and resumed tool runs can all flow through one session.

Current input content types:

- `text`
- `image` with inline base64 plus workspace-relative metadata
- `file` with workspace-relative metadata and optional preview summary

## Todo Data Model

The backend exposes Todo items with these fields:

| Field         | Meaning                        |
| ------------- | ------------------------------ |
| `id`          | TinyDB document id             |
| `title`       | Required short task title      |
| `detail`      | Optional longer notes          |
| `dueAt`       | Optional ISO datetime string   |
| `isDone`      | Completion state               |
| `completedAt` | Completion timestamp or `null` |
| `createdAt`   | Creation timestamp             |
| `updatedAt`   | Last update timestamp          |

The repository implementation stores timestamps in UTC ISO format.

## Service Layer

The main service objects are:

- `todo_service`
  CRUD-style mutations and list/get behavior

- `schedule_service`
  CRUD-style mutations and list/range behavior for schedule events

- workspace services (`workspace_service.py`, `workspace_command_service.py`)
  Workspace file reading/writing, preview metadata, text search, and command execution helpers

This separation keeps route handlers thin while preserving clear service ownership per domain.

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

Schedule follows the same path through `schedule_service` and `TinyDbScheduleRepository`, and is wired into both UI and public API.

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

The current registered schedule tools are:

- `manage_schedule`

The current workspace tools are:

- `list_workspace_files`
- `search_workspace_text`
- `read_workspace_file`
- `preview_workspace_file`
- `create_workspace_file`
- `update_workspace_file`
- `run_workspace_shell`
- `run_workspace_python`

The first four are read-only and do not require approval. File writes and command execution require approval.

### Current context providers

`CurrentInfoProvider` injects runtime metadata before each run, including:

- local time metadata
- current session id
- OS, architecture, and Python version
- public IP and network metadata from `ipinfo.io` (with session-level caching)

`WorkspaceInfoProvider` injects:

- workspace root path
- `inputs/` and `outputs/` guidance
- a short list of current workspace files

That gives the model lightweight runtime context before it decides whether to call a tool.

## Persistence Details

TinyDB path resolution is handled in `backend/repositories/tinydb/storage.py`:

- use explicit `db_path` when passed
- otherwise read `dbPath` from runtime config
- otherwise fall back to `db.json` in the current working directory

The current tables are:

- `todo_list`
- `schedule_events`

In the Electron-managed app flow, `dbPath` is derived to `db.json` beside `config.json`.

Workspace file persistence is separate from TinyDB. It is rooted at `workspacePath` from runtime config and is managed by Electron startup logic rather than the backend repository layer. In the Electron-managed app flow, that path resolves to `workspace/` beside `config.json`.

## Tests

Backend tests live under `tests/backend_suite/` and cover:

- todo route behavior
- config route behavior
- todo service behavior
- TinyDB repository round trips
- workspace tool and preview behavior
- agent tool behavior
- agent context and adapter behavior

Run them with:

```powershell
python -m unittest discover -s tests -v
```
