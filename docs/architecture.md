# Architecture

## Goal

This project is still the Student Productivity Agent described in `PROPOSAL.md`.

The architecture changed because the stack changed:

- desktop shell: Electron instead of Tauri
- frontend: plain renderer instead of React
- backend: Python
- agent runtime: Microsoft Agent Framework

The current repo is the thinnest working slice of that product. It proves the desktop boundary first, then the product can grow on top of it.

## Runtime split

There are three layers:

1. Renderer in `src/renderer`
2. Electron main process in `src/electron`
3. Python backend in `backend`

They do different jobs and should stay separate.

- Renderer owns the UI only.
- Preload exposes a tiny safe bridge.
- Electron main owns the window, IPC, backend process, and local HTTP calls.
- Python owns the API, the agent runtime, and local data access.

## Backend split

The backend is now internally layered:

1. `backend/api`: FastAPI app assembly, routes, schemas
2. `backend/agent`: runtime, tools, and context providers
3. `backend/services`: business logic and read models
4. `backend/repositories`: persistence contracts and TinyDB adapters

Preferred dependency direction:

```text
api routes -> services -> repositories
agent tools -> services -> repositories
agent context -> services -> repositories
```

`backend/db` still exists as a compatibility facade, but new code should use `backend/repositories` directly.

## Validation policy

This repo follows one validation rule:

- validate at the boundary once
- keep internal helpers simple
- do not repeat defensive checks after the boundary already normalized the data

Current boundaries are:

- renderer UI events
- preload and Electron IPC
- FastAPI request models
- `config.json` loading in Electron

That means:

- renderer checks user prompt input before invoking IPC
- Electron config code normalizes file values and runtime config updates before syncing Python
- FastAPI validates request shapes with Pydantic
- backend services and repositories assume their callers already passed normalized data

Future agents should preserve this style. If a new check is needed, add it at the first entry point for that input instead of adding the same guard in deeper layers.

## Config model

The repo has two config layers:

- startup app config in `config.json`: `backendHost`, `backendPort`
- runtime agent config mirrored into Python: `openaiApiKey`, `openaiChatModel`, `openaiEndpoint`

`config.json` is the persistent source of truth. Electron reads it on startup, starts Python with the startup config, then syncs the runtime agent config to FastAPI through `/api/config`.

Only the OpenAI runtime keys are hot-updated through IPC. Host and port are startup settings and are read once when Electron boots.

This Electron-owned config flow is intentional. The backend keeps an in-memory runtime config and does not manage the persistent config file itself.

## Request flow

Current request path:

1. User types in the renderer.
2. Renderer calls `window.agentAPI.runPrompt(message)`.
3. Preload forwards that call with `ipcRenderer.invoke(...)`.
4. Electron main receives `agent:run`.
5. Electron main sends `POST /api/agent/run` to the local FastAPI server.
6. FastAPI calls the Agent Framework client.
7. The reply comes back through the same chain to the renderer.

Health checks use the same idea through `window.agentAPI.health()` and `GET /health`.

Runtime config uses a parallel path:

1. Renderer calls `window.configAPI.get()` or `window.configAPI.save(config)`.
2. Preload forwards that call through IPC.
3. Electron config code reads or writes `config.json`.
4. Electron syncs the runtime agent config to `POST /api/config`.
5. Python updates its in-memory runtime config.

## Boot flow

1. `electron .` starts `src/electron/main.js`.
2. Electron main reads `config.json`.
3. Electron main starts `python -m uvicorn backend.app:app`.
4. FastAPI listens on the host and port from `config.json`.
5. Electron waits for `/health`.
6. Electron syncs the runtime agent config to Python.
7. The renderer becomes usable once the backend is alive and runtime config is available.

## Why this shape

- The renderer should not have process access.
- The Electron main process should not contain agent logic.
- The Python backend should not know anything about Electron windows.
- A local HTTP boundary is easier to debug and scale than a custom stdio protocol.

This gives a clean upgrade path:

- add more renderer views for chat, tasks, schedules, and settings
- add more backend routes, services, repositories, and tools
- keep the boundary stable while the product grows

For backend-specific details, see `docs/backend.md`.
