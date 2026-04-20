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

- `src/renderer/` owns the desktop UI for Chat, Todo, Schedule, and Config.
  The renderer is now split by feature under `chat/`, `todo/`, `schedule/`, `config/`, plus reusable helpers in `shared/`.
- `src/electron/preload.js` exposes a narrow bridge into the renderer.
- `src/electron/main.js` now mostly wires modules together.
- `src/electron/backend-process.js` owns the Python backend process lifecycle.
- `src/electron/config-store.js` owns `config.json` normalization, validation, persistence, and runtime sync.
- `src/electron/workspace.js` owns workspace path safety checks plus startup cleanup.
- `src/electron/attachment-staging.js` copies uploads into the workspace and builds attachment metadata.
- `src/electron/python-runtime.js` resolves the Python executable used in development versus packaged builds.
- `src/electron/ipc/` owns domain-specific IPC handlers such as `agent`, `todo`, `schedule`, and `config`.
- `backend/` owns HTTP routes, the agent runtime, local business logic, and persistence.

This split keeps the UI simple, keeps Node and process control out of the renderer, and gives the Python backend a clean local API boundary.

## Runtime Boundaries

### Renderer

The renderer is a plain HTML/CSS/JavaScript app with four pages:

- `Chat`: sends structured prompts and attachments, then renders rich streamed agent output
- `Todo`: local task management UI
- `Schedule`: local calendar event management UI
- `Config`: edits `config.json` through Electron IPC

Inside Chat, assistant text parts are rendered through `shared/markdown.js` using `markdown-it`, then KaTeX is applied only to those rendered Markdown blocks. Tool rows, approval cards, and media tiles remain structured UI elements instead of being routed through the Markdown parser.

Instead of one large renderer controller, the browser code is organized like this:

```text
renderer.js       bootstrap and page-level orchestration
chat/             chat controller and streaming UI behavior
todo/             todo state, rendering, and mutations
schedule/         schedule state, calendar rendering, and mutations
config/           config form state and save/discard flow
shared/           DOM lookup, markdown/KaTeX helpers, date helpers, page manager
```

The renderer never talks to Python directly. It only calls the APIs exposed by the preload script:

- `window.agentAPI`
- `window.todoAPI`
- `window.scheduleAPI`
- `window.configAPI`

### Preload

`src/electron/preload.js` exposes a small, explicit bridge with `contextBridge`. This is the trusted boundary between the renderer context and Electron internals.

### Electron Main Process

The Electron layer is now split into smaller modules:

- `main.js` wires the app together and creates the browser window
- `backend-process.js` starts, stops, and health-checks the Python backend
- `config-store.js` reads and writes `config.json` and pushes runtime config to Python
- `ipc/agent.js`, `ipc/todo.js`, `ipc/schedule.js`, and `ipc/config.js` register per-domain IPC handlers

Together they:

- reads and normalizes `config.json`
- derives `db.json` and `workspace/` beside `config.json`
- clears and recreates that workspace
- starts `python -m uvicorn backend.app:app` in development or the bundled Python runtime in packaged builds
- waits for `/health`
- syncs runtime config to `POST /api/config`
- registers IPC handlers for agent, todo, schedule, and config actions

Electron is also responsible for restarting the backend when `backendPort` changes. The host is fixed to `127.0.0.1`.

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
3. Electron clears and recreates `workspace/` beside that file.
4. Electron spawns `uvicorn` for `backend.app:app`.
5. Electron polls `GET /health` until the backend is ready.
6. Electron pushes runtime config to `POST /api/config`.
7. Electron creates the browser window and loads the renderer.

If the backend port changes later, Electron restarts the Python process and repeats the sync.

## Request Flows

### Chat Flow

```text
Renderer
  -> window.agentAPI.pickAttachments(...) / runPrompt(...)
  -> IPC: agent:pick-attachments / agent:run
  -> Electron copies uploads into workspace inputs/<requestId>/...
  -> Electron opens WebSocket /api/agent/run
  -> FastAPI validates structured run contents
  -> AgentRuntime streams structured message snapshots
  -> Electron forwards update / done / error events back to renderer
  -> Renderer updates the conversation live, renders assistant text with markdown-it plus KaTeX, preserves structured tool/media cards, can answer approval requests, and can interrupt in-flight runs
```

The WebSocket path is used so the UI can render streaming output, surface tool approvals inline, and resume the same run after the user approves or rejects an action.

When the user interrupts a run, Electron closes the active run socket and the backend persists partial run history before cleanup.

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

### Schedule Flow

```text
Renderer
  -> window.scheduleAPI.*
  -> IPC handlers in src/electron/ipc/schedule.js
  -> HTTP calls to /api/schedules...
  -> schedule_service
  -> TinyDbScheduleRepository
  -> TinyDB table: schedule_events
```

The Schedule page is a real local workflow with calendar navigation, event CRUD, and range queries through the backend.

### Config Flow

There are two config layers:

- persistent app config in `config.json`
- in-memory backend runtime config in `backend/config.py`

The flow is:

1. Renderer edits config through `window.configAPI`.
2. Electron validates and writes `config.json`.
3. Electron derives absolute runtime paths for `db.json` and `workspace/` beside that file, then resets the workspace.
4. Electron restarts the backend if the port changed.
5. Electron syncs runtime values to `POST /api/config`.
6. Python updates its in-memory runtime config.

This keeps file ownership in Electron while allowing the backend to react to runtime model changes.

## Persistence

TinyDB is the current storage layer.

- Todo data is stored in the `todo_list` table.
- Schedule data is stored in the `schedule_events` table.
- The active database path is `db.json` beside the active `config.json`.
- Uploaded files and generated artifacts live in `workspace/` beside the active `config.json`.
- Electron recreates `inputs/` and `outputs/` inside that workspace every time the app starts.

Both Todo and Schedule are surfaced through the UI and HTTP API.

## Agent Integration

The Python agent runtime lives in `backend/agent/`.

- `runtime.py` builds or rebuilds the chat client from runtime config
- `instructions.py` defines the base behavior prompt
- `tools/todo_tool.py` exposes `list_todos`, `create_todo`, `update_todo`, and `delete_todo`
- `tools/schedule_tool.py` exposes `manage_schedule` for listing and mutating schedule events
- `tools/workspace_tool.py` exposes workspace file tools, preview helpers, plus approval-gated shell and Python tools
- `context/current_info.py` injects runtime environment and network context before each run
- `context/workspace_info.py` injects workspace root, uploaded input location, and output guidance before each run

The current agent is therefore stateful enough to:

- chat with the configured model
- inspect local todos without approval and request approval before changing them
- inspect and manage local schedule events with the schedule tool
- inspect and edit workspace files with tool approval where appropriate
- prepare inline previews for text, image, PDF, audio, and video workspace files
- run local PowerShell and Python inside the workspace after approval
- receive runtime environment context (time, host runtime info, and public IP metadata) on each run
- receive workspace state guidance on each run

## Extension Guidance

When the project grows, keep these boundaries stable:

- UI-only work stays in `src/renderer/`
- renderer-to-system calls go through preload and IPC
- new backend features should enter through `api`, `services`, and `repositories`
- agent tools should call services instead of reaching into storage directly

That approach will let the app grow into schedules, notifications, and richer campus features without collapsing responsibilities together.
