# Product Scope

Student Productivity Agent is a local desktop planner for students. Release 1 keeps the product narrow: chat, tasks, schedule events, and local settings.

The app is a prototype that proves the Electron UI, Python backend, local persistence, and approval-gated assistant tools can work together.

## Release 1 Surfaces

### Chat

The Chat page lets a user send prompts and attachments to the Python-backed assistant. Responses stream into the UI and render Markdown plus KaTeX. Tool calls, tool results, approvals, media previews, and interruption controls are shown inline.

### Todo

The Todo page is the main planning surface. It supports task CRUD, completion state, due dates, search, sorting, filters, bulk clearing, undo after delete, and TinyDB persistence.

### Schedule

The Schedule page adds calendar events. It supports month navigation, event CRUD, range reads through the backend API, and TinyDB persistence.

### Config

The Config page edits local runtime settings:

- `backendPort`
- `openaiApiKey`
- `openaiChatModel`
- `openaiEndpoint`
- `motdLanguage`

Electron owns the persistent config file. The Python backend receives a synced runtime copy.

## Assistant Capabilities

The assistant can:

- answer chat prompts through the configured model
- inspect local tasks and schedule events
- request approval before changing tasks or schedule events
- inspect files staged in the local workspace
- preview common workspace file types
- create or update workspace text files after approval
- run local PowerShell or Python commands inside the workspace after approval

## Not In Release 1

The original proposal included a broader campus productivity platform. These ideas are useful future work, but they are not part of the simplified implementation target:

- campus knowledge retrieval
- reminders and local notifications
- Blackboard integration
- Microsoft To Do or calendar sync
- one-click packaged runtime preparation

## Proposal Relationship

The proposal described a larger product and an earlier technical direction. The current implementation uses Electron, vanilla renderer code, FastAPI, and TinyDB. Use the proposal only as historical context; use this file and `docs/feature.md` for current scope.
