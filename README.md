# Student Productivity Agent

Student Productivity Agent is a desktop prototype for a student-facing planning assistant. The current implementation combines an Electron shell, a plain JavaScript renderer, and a Python FastAPI backend into one local app.

This repository already contains a working vertical slice:

- a streamed chat page backed by a Python agent runtime, with run interruption and inline tool approvals
- a workspace-enabled chat flow that stages uploads into a local workspace on every run
- approval-gated workspace tools for file editing plus local PowerShell and Python execution
- a local-first Todo workspace with CRUD, filtering, sorting, and undo
- a local-first Schedule workspace with calendar navigation plus CRUD over `/api/schedules`
- a config page that edits local settings and syncs runtime model config to Python
- local persistence through TinyDB

`docs/PROPOSAL.md` is the original project proposal and should be treated as historical context. The rest of the documentation describes the codebase as it exists today.

## Current Stack

- Desktop shell: Electron
- Renderer: HTML, CSS, vanilla JavaScript
- Backend API: FastAPI
- Agent runtime: `agent-framework` with an OpenAI-compatible chat client
- Local storage: TinyDB

## Quick Start

1. Install Node.js and a recent `python` interpreter.
2. Install frontend dependencies:

```powershell
npm install
```

3. Install backend dependencies:

```powershell
python -m pip install -r backend/requirements.txt
```

4. Edit `config.json` and set the values your environment needs:

- `backendPort`
- `openaiApiKey`
- `openaiChatModel`
- `openaiEndpoint`
- `motdLanguage` (`zh-CN` or `en`)

5. Start the desktop app:

```powershell
npm start
```

When the backend is reachable and `openaiChatModel` is configured, the app status changes to `ready`.

Uploaded files are copied into `workspace/inputs/<requestId>/...` beside `config.json`. The workspace is cleared and recreated on every app start.

## Running Only The Backend

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Electron normally starts the backend for you, but this command is useful when testing the API in isolation.

## Tests

Run everything:

```powershell
npm test
```

Or run suites separately:

```powershell
python -m unittest discover -s tests -v
```

```powershell
node --test tests/electron/*.test.js
```

The current automated tests focus on backend routes, repositories, todo services, and agent-facing adapters.

## Repository Map

```text
backend/        Python API, agent runtime, services, repositories
docs/           Implementation-focused project documentation
src/electron/   Electron main process, preload bridge, IPC, config sync
src/renderer/   Desktop UI for chat, todo, and config pages
tests/          Python unittest suites for backend behavior
```

## Documentation

- [docs/README.md](./docs/README.md): documentation index
- [docs/product.md](./docs/product.md): current product scope and implemented features
- [docs/architecture.md](./docs/architecture.md): runtime boundaries and request flows
- [docs/backend.md](./docs/backend.md): backend modules, API surface, persistence, and agent runtime
- [docs/development.md](./docs/development.md): setup, config, testing, and contributor guidance
- [docs/windows-packaging.md](./docs/windows-packaging.md): Windows installer build flow with a bundled Python runtime
- [docs/PROPOSAL.md](./docs/PROPOSAL.md): original proposal kept for historical reference

## Notes

- `config.json` is the persistent source of truth for local app settings in development. Packaged Windows builds use `%LOCALAPPDATA%\kao-hsiao\config.json`.
- Electron always connects to the local backend on `127.0.0.1`; only `backendPort` is configurable.
- Electron stores TinyDB in `db.json` beside the active `config.json`.
- Electron stores the workspace in `workspace/` beside the active `config.json`.
- Schedule is available through the renderer Schedule page and backend `/api/schedules` endpoints.
- Avoid committing real API keys or environment-specific secrets.
