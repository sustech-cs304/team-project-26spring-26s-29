# SUSTech Student Assistant

[中文版本](./README.zh-CN.md)

SUSTech Student Assistant is a local desktop app for Southern University of
Science and Technology students. It combines a chat assistant, todo planning,
calendar events, Blackboard sync, and SUSTech-oriented campus knowledge from
NanKe Manual (南科手册) materials.

The app is a small local prototype built with Electron, vanilla JavaScript,
FastAPI, and TinyDB. Electron runs the desktop shell and starts the Python
backend automatically during normal use.

## Key Features

- Chat with a Python-backed assistant through an OpenAI-compatible model.
- Upload local files into a temporary workspace for assistant inspection.
- Manage todos with due dates, completion state, search, sorting, filters, bulk
  clearing, and undo after delete.
- Mirror todo due dates into linked schedule events.
- Create and update schedule events in a calendar view.
- Sign in to SUSTech Blackboard in a dedicated window, sync remote items, and
  review suggested todo or schedule changes before applying them.
- Search SUSTech-oriented campus knowledge built from NanKe Manual and related
  bundled documents.
- Configure backend port, model settings, endpoint, API key, and UI language
  from local settings.

## Tech Stack

- Desktop shell: Electron
- Renderer: HTML, CSS, vanilla JavaScript
- Backend API: FastAPI
- Agent runtime: `agent-framework` with an OpenAI-compatible chat client
- Local storage: TinyDB
- Rich chat text: `markdown-it` and KaTeX
- Packaging: `electron-builder` for Windows NSIS builds

## Repository Layout

```text
backend/        FastAPI routes, services, repositories, Blackboard sync, and agent runtime
src/electron/   Electron main process, preload bridge, IPC, and backend process control
src/renderer/   Chat, Todo, Schedule, Blackboard, and Config UI
tests/          Backend and Electron-side tests
docs/           Product, architecture, backend, development, and packaging docs
tools/          Corpus build and CI helper scripts
vendor/         Bundled third-party and SUSTech-oriented source materials
```

## Prerequisites

- Node.js with npm
- A recent Python interpreter available as `python`
- Network access to the configured OpenAI-compatible chat endpoint if you want
  to use the assistant chat features
- SUSTech Blackboard credentials if you want to use Blackboard sync

## Installation

Install JavaScript dependencies:

```powershell
npm install
```

Install Python dependencies:

```powershell
python -m pip install -r backend/requirements.txt
```

Optional: rebuild the local SUSTech manual corpus:

```powershell
npm run build:sustech-manual
```

## Configuration

The development config file is `config.json` in the repository root. The app
expects these keys:

| Key | Purpose |
| --- | --- |
| `backendPort` | Local port used by Electron to reach the FastAPI backend |
| `openaiApiKey` | API key for the configured chat provider |
| `openaiChatModel` | Model name used by the assistant runtime |
| `openaiEndpoint` | OpenAI-compatible base URL |
| `appLanguage` | UI and default assistant language, usually `zh-CN` or `en` |

Example config shape:

```json
{
  "backendPort": 8765,
  "openaiApiKey": "YOUR_API_KEY",
  "openaiChatModel": "YOUR_MODEL_NAME",
  "openaiEndpoint": "https://api.example.com/v1",
  "appLanguage": "zh-CN"
}
```

Do not commit real API keys or personal credentials. TinyDB data is stored in
`db.json` beside the active config file. Electron also creates a local
`workspace/` directory for uploaded files and generated artifacts; that
workspace is cleared and recreated on app startup.

## Running the Desktop App

Start the app from the repository root:

```powershell
npm start
```

Electron opens the desktop UI and starts the Python backend automatically. When
the backend is reachable and the chat model is configured, the app status
changes to `ready`.

## Running the Backend Only

Use this mode when you want to test the API without Electron:

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Then check the health endpoint:

```powershell
curl.exe http://127.0.0.1:8765/health
```

## Usage Examples

### Chat

1. Open the desktop app with `npm start`.
2. Go to the Chat page.
3. Ask a question such as:

```text
Summarize my upcoming todos and schedule events for this week.
```

4. If the assistant asks for permission before changing local todos, schedules,
   or workspace files, review the request before approving it.

### Todo Planning

1. Open the Todo page.
2. Create a task with a title and due time, for example:

```text
Title: Submit CS304 milestone report
Due: 2026-06-03 23:59
```

3. The todo is persisted in TinyDB. If it has a due time, the app also creates a
   linked schedule event.
4. Mark the todo complete or edit the due time to update the linked event.

### Schedule

1. Open the Schedule page.
2. Add an event such as:

```text
Title: Group meeting
Time: 2026-06-01 15:00-16:00
Location: Library
```

3. Navigate by month to review upcoming events.

### Blackboard Sync

1. Open the Blackboard page.
2. Start the Blackboard login flow and sign in through the dedicated window.
3. Run sync to collect announcements, content items, and gradebook columns.
4. Review generated suggestions before applying them to Todo or Schedule.

### Backend API Snapshot

When the backend is running on port `8765`, you can create and read todos
directly:

```powershell
curl.exe -X POST http://127.0.0.1:8765/api/todos `
  -H "Content-Type: application/json" `
  -d "{\"title\":\"Read NanKe Manual\",\"dueAt\":\"2026-06-01T10:00:00\"}"

curl.exe http://127.0.0.1:8765/api/todos
```

## Screenshots / Snapshots

Recommended screenshots for project reports or demos:

- Chat page with a rendered assistant response
- Todo page showing an active task and its due date
- Schedule page showing a linked event
- Blackboard page showing reviewed suggestions
- Config page showing non-secret local settings

Place screenshots under a directory such as `docs/screenshots/` and link them
from this section. Do not include API keys, Blackboard credentials, or private
student data in screenshots.

## Testing

Run the full test suite:

```powershell
npm test
```

Run backend tests only:

```powershell
npm run test:backend
```

Run Electron-side tests only:

```powershell
npm run test:electron
```

## Build for Windows

The Windows package flow rebuilds the SUSTech manual corpus and then runs
`electron-builder`:

```powershell
npm run package:win
```

See [docs/windows-packaging.md](./docs/windows-packaging.md) for details about
the bundled Python runtime and installer artifacts.

## Known Issues and Limitations

- This is a local prototype, not a hosted multi-user service.
- Assistant chat requires a working OpenAI-compatible endpoint and API key.
- Blackboard sync is SUSTech-specific and depends on the current Blackboard
  login/session flow.
- The bundled campus knowledge is SUSTech-specific and is not a universal
  student knowledge base.
- Reminders, local notifications, Microsoft To Do sync, and external calendar
  sync are outside the current Release 1 scope.
- The local `workspace/` directory is recreated on every app startup, so do not
  use it as long-term storage.

## Additional Resources

- [Documentation index](./docs/README.md)
- [Product scope](./docs/product.md)
- [Feature requirements](./docs/feature.md)
- [Architecture](./docs/architecture.md)
- [Backend API and modules](./docs/backend.md)
- [Development guide](./docs/development.md)
- [Windows packaging guide](./docs/windows-packaging.md)
- [Historical proposal](./docs/presentation/proposal-26s-29.md)
