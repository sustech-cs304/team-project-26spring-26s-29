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
- Python owns the API, the agent call, and model credentials.

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

## Boot flow

1. `electron .` starts `src/electron/main.js`.
2. If the shell forces `ELECTRON_RUN_AS_NODE=1`, `main.js` relaunches itself in normal Electron mode.
3. Electron main starts `python -m backend.app`.
4. FastAPI listens on `BACKEND_HOST:BACKEND_PORT`.
5. Electron waits for `/health`.
6. The renderer becomes usable once the backend is alive.

## Why this shape

- The renderer should not have process access.
- The Electron main process should not contain agent logic.
- The Python backend should not know anything about Electron windows.
- A local HTTP boundary is easier to debug and scale than a custom stdio protocol.

This gives a clean upgrade path:

- add more renderer views for chat, tasks, schedules, and settings
- add more backend routes and tools
- keep the boundary stable while the product grows
