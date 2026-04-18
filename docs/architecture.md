# Architecture

This document explains how the current application is put together. It is implementation-first: every section maps to code that already exists in this repository.

## System Overview

The app is split into four runtime layers:

```text
Renderer UI
  -> preload bridge
  -> Electron main process
  -> local HTTP / WebSocket boundary
  -> FastAPI backend
  -> services / repositories / TinyDB
```

### Layer responsibilities

- `src/renderer/` owns the desktop UI for Chat, Todo, and Config.
  The renderer is now split by feature under `chat/`, `todo/`, `config/`, plus reusable helpers in `shared/`.
- `src/electron/preload.js` exposes a narrow bridge into the renderer.
- `src/electron/main.js` now mostly wires modules together.
- `src/electron/backend-process.js` owns the Python backend process lifecycle.
- `src/electron/config-store.js` owns `config.json` normalization, validation, persistence, and runtime sync.
- `src/electron/ipc/` owns domain-specific IPC handlers such as `agent`, `todo`, and `config`.
- `backend/` owns HTTP routes, the agent runtime, local business logic, and persistence.

This split keeps the UI simple, keeps Node and process control out of the renderer, and gives the Python backend a clean local API boundary.

## Runtime Boundaries

### Renderer

The renderer is a plain HTML/CSS/JavaScript app with three pages:

- `Chat`: sends structured prompts and attachments, then renders rich streamed agent output
- `Todo`: local task management UI
- `Config`: edits `config.json` through Electron IPC

Instead of one large renderer controller, the browser code is organized like this:

```text
renderer.js       bootstrap and page-level orchestration
chat/             chat controller and streaming UI behavior
todo/             todo state, rendering, and mutations
config/           config form state and save/discard flow
shared/           DOM lookup, markdown, date helpers, page manager
```

The renderer never talks to Python directly. It only calls the APIs exposed by the preload script:

- `window.agentAPI`
- `window.todoAPI`
- `window.configAPI`

### Preload

`src/electron/preload.js` exposes a small, explicit bridge with `contextBridge`. This is the trusted boundary between the renderer context and Electron internals.

### Electron Main Process

The Electron layer is now split into smaller modules:

- `main.js` wires the app together and creates the browser window
- `backend-process.js` starts, stops, and health-checks the Python backend
- `config-store.js` reads and writes `config.json` and pushes runtime config to Python
- `ipc/agent.js`, `ipc/todo.js`, and `ipc/config.js` register per-domain IPC handlers

Together they:

- reads and normalizes `config.json`
- starts `python -m uvicorn backend.app:app`
- waits for `/health`
- syncs runtime config to `POST /api/config`
- registers IPC handlers for agent, todo, and config actions

Electron is also responsible for restarting the backend when `backendHost` or `backendPort` changes.

### Python Backend

The backend exposes FastAPI routes and owns the agent runtime. Internally, it is organized like this:

```text
api routes -> services -> repositories -> TinyDB
agent tools -> services -> repositories -> TinyDB
agent context -> services -> repositories -> TinyDB
```

That structure keeps transport logic, domain logic, and storage concerns separate.

## Boot Sequence

Application startup currently works like this:

1. `npm start` launches Electron.
2. Electron reads `config.json`.
3. Electron spawns `uvicorn` for `backend.app:app`.
4. Electron polls `GET /health` until the backend is ready.
5. Electron pushes runtime config to `POST /api/config`.
6. Electron creates the browser window and loads the renderer.

If the backend host or port changes later, Electron restarts the Python process and repeats the sync.

## Request Flows

### Chat Flow

```text
Renderer
  -> window.agentAPI.runPrompt(...)
  -> IPC: agent:run
  -> Electron opens WebSocket /api/agent/run
  -> FastAPI validates structured run contents
  -> AgentRuntime streams structured message snapshots
  -> Electron forwards update / done / error events back to renderer
  -> Renderer updates the conversation live and can answer approval requests
```

The WebSocket path is used so the UI can render streaming output, surface tool approvals inline, and resume the same run after the user approves or rejects an action.

### Todo Flow

```text
Renderer
  -> window.todoAPI.*
  -> IPC handlers in src/electron/ipc/todo.js
  -> HTTP calls to /api/todos...
  -> todo_service
  -> TinyDbTodoRepository
  -> TinyDB table: todo_list
```

The Todo page is a real local workflow, not just demo state. It supports persistence, validation, and round trips through the backend.

### Config Flow

There are two config layers:

- persistent app config in `config.json`
- in-memory backend runtime config in `backend/config.py`

The flow is:

1. Renderer edits config through `window.configAPI`.
2. Electron validates and writes `config.json`.
3. Electron restarts the backend if host or port changed.
4. Electron syncs runtime values to `POST /api/config`.
5. Python updates its in-memory runtime config.

This keeps file ownership in Electron while allowing the backend to react to runtime model changes.

## Persistence

TinyDB is the current storage layer.

- Todo data is stored in the `todo_list` table.
- Schedule groundwork is stored in the `schedule_events` table.
- The active database path comes from `dbPath` in config, or falls back to `db.json`.

Only Todo is currently surfaced through the UI and HTTP API. Schedule storage exists as backend groundwork for future features.

## Agent Integration

The Python agent runtime lives in `backend/agent/`.

- `runtime.py` builds or rebuilds the chat client from runtime config
- `instructions.py` defines the base behavior prompt
- `tools/todo_tool.py` exposes `list_todos`, `create_todo`, `update_todo`, and `delete_todo`
- `context/current_info.py` injects time and todo summary context before each run

The current agent is therefore stateful enough to:

- chat with the configured model
- inspect local todos without approval and request approval before changing them
- receive a short summary of current time and todo state on each run

## Extension Guidance

When the project grows, keep these boundaries stable:

- UI-only work stays in `src/renderer/`
- renderer-to-system calls go through preload and IPC
- new backend features should enter through `api`, `services`, and `repositories`
- agent tools should call services instead of reaching into storage directly

That approach will let the app grow into schedules, notifications, and richer campus features without collapsing responsibilities together.
