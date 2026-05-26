# Product Scope

SUSTech Student Assistant is a local desktop assistant designed first for
Southern University of Science and Technology students. It combines generic
student productivity tools with SUSTech-specific proprietary/domain campus
knowledge, including NanKe Manual (南科手册) content.

Release 1 keeps the product narrow: chat, tasks, schedule events, Blackboard
sync, local settings, and SUSTech-oriented manual corpus support. The app is a
prototype that proves the Electron UI, Python backend, local persistence,
campus corpus build flow, and approval-gated assistant tools can work together.

## Release 1 Surfaces

### Chat

The Chat page lets a user send prompts and attachments to the Python-backed assistant. Responses stream into the UI and render Markdown plus KaTeX. Tool calls, tool results, approvals, media previews, and interruption controls are shown inline.

### Todo

The Todo page is the main planning surface. It supports task CRUD, completion state, due dates, search, sorting, filters, bulk clearing, undo after delete, and TinyDB persistence. A todo with a due time is also mirrored into a short linked schedule event, and that linked event is updated or removed when the todo changes.

### Schedule

The Schedule page adds calendar events. It supports month navigation, event CRUD, completion state, range reads through the backend API, and TinyDB persistence.

### Blackboard

The Blackboard page lets a user open a dedicated SUSTech Blackboard login
window, sync announcements, content items, and gradebook columns, then review
suggested changes before applying them to Todo or Schedule. The sync state,
remote item hashes, and suggestions are stored locally in TinyDB.

### SUSTech Knowledge

The project includes a SUSTech-oriented knowledge corpus built from NanKe Manual
materials and related campus documents. This content is domain-specific: it is
part of the SUSTech assistant experience, while the todo and schedule workflows
remain broadly reusable for other student planning contexts.

### Config

The Config page edits local runtime settings:

- `backendPort`
- `openaiApiKey`
- `openaiChatModel`
- `openaiEndpoint`
- `appLanguage`

Electron owns the persistent config file. The Python backend receives a synced runtime copy.

## Assistant Capabilities

The assistant can:

- answer chat prompts through the configured model
- search and read SUSTech-oriented manual content when the corpus is built
- fetch the live SUSTech manual page that corresponds to a local source path
- inspect local tasks and schedule events
- request approval before changing tasks or schedule events
- inspect files staged in the local workspace
- preview common workspace file types
- create or update workspace text files after approval
- run local PowerShell or Python commands inside the workspace after approval

## Not In Release 1

The original proposal included a broader campus productivity platform. These ideas are useful future work, but they are not part of the simplified implementation target:

- reminders and local notifications
- Microsoft To Do or calendar sync
- one-click packaged runtime preparation

## Proposal Relationship

The proposal described a larger product and an earlier technical direction. The current implementation uses Electron, vanilla renderer code, FastAPI, and TinyDB. Use the proposal only as historical context; use this file and `docs/feature.md` for current scope.
