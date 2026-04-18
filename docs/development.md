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

| Key | Meaning |
| --- | --- |
| `backendHost` | Host Electron uses to reach the local backend |
| `backendPort` | Port Electron uses to reach the local backend |
| `dbPath` | Optional TinyDB file path |
| `openaiApiKey` | API key for the configured chat provider |
| `openaiChatModel` | Model name used by the backend runtime |
| `openaiEndpoint` | Optional OpenAI-compatible base URL |

Rules to remember:

- Electron owns the file on disk.
- Python owns only an in-memory copy of runtime config.
- Changing host or port causes Electron to restart the backend.
- Changing runtime model settings causes Electron to resync Python.

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

`package.json` does not currently provide a real `npm test` workflow, so backend tests are the main automated safety net.

## Where To Make Changes

### UI changes

- page structure and behavior: `src/renderer/`
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
- Schedule groundwork is stored in TinyDB table `schedule_events`.
- If `dbPath` is unset, the backend falls back to `db.json` in the current working directory.

For the Electron-managed app flow, that default file is normally the project-root `db.json`.

## Documentation Maintenance

If you change the repo in a meaningful way, update the docs in the same branch:

- update `README.md` for setup or user-facing behavior changes
- update `docs/architecture.md` for boundary or flow changes
- update `docs/backend.md` for endpoint, data model, or backend structure changes
- update `docs/product.md` when the shipped scope changes

`docs/PROPOSAL.md` should stay unchanged as the original planning document.
