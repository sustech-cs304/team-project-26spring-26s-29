# Student Productivity Agent

This project still serves the product goal described in [PROPOSAL.md](./PROPOSAL.md): a desktop AI agent for SUSTech students that brings planning, reminders, campus information, and task management into one place.

What changed is the stack, not the purpose.

- Old proposal stack: Tauri + React + Python
- Current stack: Electron + plain renderer + Python

The current repo is a minimal foundation for that product. Right now it proves the critical desktop boundary first:

- Electron owns the app window, preload bridge, IPC, and Python process lifecycle.
- Python owns the backend API and the Microsoft Agent Framework agent.
- The renderer is intentionally small and only talks through the Electron bridge.

## Current scope

This version is not the full productivity agent yet. It is the first working slice:

- a desktop window
- a renderer -> Electron -> Python call chain
- a FastAPI backend
- a real Agent Framework call path

That is the base we can build on for chat, schedules, tasks, campus knowledge, notifications, and safe automation later.

## Structure

```text
backend/
docs/
src/electron/
src/renderer/
```

## Run

1. Create `.env` from `.env.example`.
2. Make sure `python` can import `agent_framework`, `fastapi`, and `uvicorn`.
3. Run `npm start`.

## Backend only

```powershell
python -m backend.app
```

Endpoints:

- `GET http://127.0.0.1:8765/health`
- `POST http://127.0.0.1:8765/api/agent/run`

## Notes

- `PROPOSAL.md` still describes the intended product direction.
- The technical stack in that proposal is outdated.
- The repo implementation should follow Electron + Python from now on.
