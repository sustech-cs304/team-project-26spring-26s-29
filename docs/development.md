# Development Guide

This guide is for teammates working in the repository day to day.

## Prerequisites

- Node.js for the Electron app
- a recent `python` interpreter
- Python packages from `backend/requirements.txt`

## Local Setup

Install JavaScript dependencies:

```powershell
npm install
```

Install Python dependencies:

```powershell
python -m pip install -r backend/requirements.txt
```

## Config File

The persistent config file is `config.json` in the project root.

Current keys:

| Key               | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| `backendPort`     | Port Electron uses to reach the local backend           |
| `openaiApiKey`    | API key for the configured chat provider                |
| `openaiChatModel` | Model name used by the backend runtime                  |
| `openaiEndpoint`  | Optional OpenAI-compatible base URL                     |
| `motdLanguage`    | Startup message language for Chat (`zh-CN` or `en`)     |

Rules to remember:

- Electron owns the file on disk.
- Python owns only an in-memory copy of runtime config.
- Electron always uses `127.0.0.1` for the backend host, and changing the port causes Electron to restart the backend.
- Changing runtime model settings causes Electron to resync Python.
- Electron derives `db.json` and `workspace/` beside the active `config.json`.
- Electron clears and recreates that workspace before syncing Python.
- Packaged Windows builds move the persistent config file under `%LOCALAPPDATA%\kao-hsiao\config.json`.

## Common Commands

Start the desktop app:

```powershell
npm start
```

Run only the backend:

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Run backend tests:

```powershell
python -m unittest discover -s tests -v
```

Run Electron-side unit tests:

```powershell
node --test tests/electron/*.test.js
```

Run both:

```powershell
npm test
```

`package.json` defines a real `npm test` workflow that runs backend and Electron test suites.

## Where To Make Changes

### UI changes

- page structure and behavior: `src/renderer/`
- assistant Markdown and formula rendering: `src/renderer/shared/markdown.js`
- safe renderer bridge: `src/electron/preload.js`
- IPC and process orchestration: `src/electron/`

### Backend changes

Follow the current direction:

```text
routes -> services -> repositories
tools -> services -> repositories
context -> services -> repositories
```

That means:

- request validation belongs in `backend/api/schemas/`
- HTTP route assembly belongs in `backend/api/routes/`
- business logic belongs in `backend/services/`
- persistence belongs in `backend/repositories/`

## Persistence Notes

- Todo data is stored in TinyDB table `todo_list`.
- Schedule data is stored in TinyDB table `schedule_events`.
- In the Electron-managed app flow, TinyDB lives in `db.json` beside the active `config.json`.
- Uploaded files and generated artifacts live in `workspace/` beside that same `config.json`, with `inputs/` and `outputs/` recreated on every application start.

## Documentation Maintenance

If you change the repo in a meaningful way, update the docs in the same branch:

- update `README.md` for setup or user-facing behavior changes
- update `docs/architecture.md` for boundary or flow changes
- update `docs/backend.md` for endpoint, data model, or backend structure changes
- update `docs/product.md` when the shipped scope changes
- update `docs/windows-packaging.md` when the Windows build/runtime bundling workflow changes
- update `docs/presentation/` when course deliverables or historical planning docs change

`docs/presentation/proposal-26s-29.md` should stay unchanged as the original planning document.
