# Backend Architecture

## Purpose

The backend is the Python process started by Electron. It serves three jobs:

- expose local HTTP and WebSocket endpoints for the desktop app
- run the agent runtime and tool adapters
- persist local data through repositories

Electron remains the owner of app startup and persistent config. The backend receives runtime config through `/api/config`, which is the intended design for this repo.

## Directory layout

```text
backend/
  app.py
  config.py
  api/
    app.py
    routes/
    schemas/
  agent/
    runtime.py
    instructions.py
    context/
    tools/
  services/
  repositories/
    tinydb/
  db/
```

### Responsibilities

- `backend/app.py`: stable ASGI entry point for `uvicorn`
- `backend/config.py`: in-memory runtime config store updated by Electron
- `backend/api/`: FastAPI assembly, route handlers, request/response schemas
- `backend/agent/`: agent runtime, tool registration, context providers
- `backend/services/`: business logic and read-model assembly
- `backend/repositories/`: persistence contracts and TinyDB implementations
- `backend/db/`: compatibility facade over repositories; avoid adding new logic here

## Dependency direction

New backend code should follow this direction:

```text
api routes -> services -> repositories
agent tools -> services -> repositories
agent context -> services -> repositories
```

Rules:

- `api` validates and translates transport data, but does not implement storage logic
- `services` own business rules
- `repositories` own TinyDB access
- `agent/runtime.py` owns agent lifecycle only
- new code should import from `backend.agent`, `backend.services`, and `backend.repositories`
- new code should not import from `backend.db` unless it is maintaining compatibility

## Todo flow

Current todo handling is split like this:

1. FastAPI route in `backend/api/routes/todos.py`
2. Business operation in `backend/services/todo_service.py`
3. TinyDB adapter in `backend/repositories/tinydb/todo_repository.py`

The same service is reused by:

- `backend/agent/tools/todo_tool.py` for tool calls
- `backend/services/todo_query_service.py` for runtime summaries
- `backend/agent/context/current_info.py` for prompt context injection

This keeps todo rules in one place and avoids route/tool/context drift.

## Agent flow

`backend/agent/runtime.py` owns:

- reading runtime model config from `backend/config.py`
- rebuilding the agent client when config changes
- holding the current session
- formatting streamed tool events and text chunks

Tool definitions live in `backend/agent/tools/`, and context providers live in `backend/agent/context/`.

## Config model

This repo intentionally keeps persistent config in Electron:

- `config.json` is read and written by Electron
- Electron starts Python with host/port settings
- Electron pushes runtime model config to `POST /api/config`
- the backend stores the synced runtime values in memory through `backend/config.py`
- when `dbPath` is unset, TinyDB defaults to `db.json` under the backend process cwd

This means the backend is runtime-configurable without owning the source file on disk.

## Tests

Backend tests use the standard library `unittest` runner and temporary TinyDB files.

```powershell
python -m unittest discover -s tests -v
```

Coverage currently includes:

- todo service behavior
- TinyDB repository round trips
- FastAPI todo/config routes
- agent tool and context adapters
