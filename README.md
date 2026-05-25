# SUSTech Student Assistant

A local desktop app designed first for Southern University of Science and
Technology (SUSTech) students. It combines SUSTech-specific proprietary/domain
content, including NanKe Manual (南科手册) materials, with general student
planning tools.

The app focuses on five practical workflows:

- chat with a local Python-backed assistant
- manage tasks and due dates
- manage schedule events
- sync Blackboard items into reviewed todo/schedule suggestions
- search and use SUSTech-oriented campus knowledge

Todo, schedule, local configuration, and chat workflows are generic enough for
other student productivity use cases. The bundled campus knowledge, manual
corpus, and Blackboard sync path are SUSTech-specific proprietary/domain
content, not a universal knowledge base.

The project is intentionally a small local prototype. It uses Electron for the desktop shell, vanilla JavaScript for the UI, FastAPI for the backend, and TinyDB for local persistence.

`docs/presentation/proposal-26s-29.md` is historical context. The current project scope is documented in `docs/`.

## Stack

- Desktop shell: Electron
- Renderer: HTML, CSS, vanilla JavaScript
- Backend API: FastAPI
- Agent runtime: `agent-framework` with an OpenAI-compatible chat client
- Local storage: TinyDB
- Rich chat text: `markdown-it` and KaTeX
- Campus knowledge corpus: NanKe Manual / SUSTech-oriented documents
- Blackboard sync: Electron login window, FastAPI sync service, reviewed suggestions

## Quick Start

1. Install Node.js and a recent `python` interpreter.
2. Install dependencies:

```powershell
npm install
python -m pip install -r backend/requirements.txt
```

3. Edit `config.json`:

- `backendPort`
- `openaiApiKey`
- `openaiChatModel`
- `openaiEndpoint`
- `appLanguage` (`zh-CN` or `en`)

4. Start the app:

```powershell
npm start
```

Electron starts the Python backend automatically. When the backend is reachable and a chat model is configured, the app status changes to `ready`.

## Backend Only

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Use this when testing the API without Electron.

## Tests

```powershell
npm test
```

This runs both suites:

```powershell
python -m unittest discover -s tests -v
node --test tests/electron/*.test.js
```

## Repository Map

```text
backend/        FastAPI routes, services, repositories, Blackboard sync, and agent runtime
src/electron/   Electron main process, preload bridge, IPC, and config sync
src/renderer/   Chat, Todo, Schedule, Blackboard, and Config UI
tests/          Backend and Electron tests
docs/           Current documentation and presentation materials
vendor/         Bundled third-party and SUSTech-oriented source materials
```

## Notes

- `config.json` is the development source of truth for local settings.
- TinyDB data lives in `db.json` beside the active config file, including
  todos, schedules, todo-schedule bindings, and Blackboard sync state.
- Uploaded files are staged into `workspace/inputs/<requestId>/...`.
- The workspace is cleared and recreated on every app start.
- SUSTech-specific corpus files are built with `npm run build:sustech-manual`
  and validated with `npm run validate:sustech-manual`.
- Avoid committing real API keys or environment-specific secrets.

## Docs

- [docs/README.md](./docs/README.md): documentation index
- [docs/product.md](./docs/product.md): simplified product scope
- [docs/feature.md](./docs/feature.md): Release 1 requirements
- [docs/architecture.md](./docs/architecture.md): runtime boundaries and request flows
- [docs/backend.md](./docs/backend.md): backend modules and API details
- [docs/development.md](./docs/development.md): setup, config, and testing
- [docs/windows-packaging.md](./docs/windows-packaging.md): Windows installer flow
