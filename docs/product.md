# Current Product Scope

This repository is the current implementation of the Student Productivity Agent project. It is no longer just a proposal, but it is also not the full long-term product yet.

## What Exists Today

The app already provides four working desktop surfaces.

## Chat Workspace

- The renderer sends structured chat inputs through Electron IPC.
- Electron stages every upload into the configured workspace before it reaches the backend.
- Electron forwards chat requests to the local Python backend.
- The backend streams structured message snapshots over WebSocket.
- Assistant text is rendered as Markdown with `markdown-it`, with KaTeX handling inline and display math.
- Tool calls and approval requests stay in structured single-line cards instead of being reinterpreted as Markdown.
- The UI renders images and files as media tiles with a preview modal for inline inspection and save/copy actions.
- Users can interrupt an in-flight run and optionally toggle always-approve for tool requests.

This is the main proof that the desktop shell, local backend, and agent runtime can work together.

## Todo Workspace

The Todo page is the most complete feature in the app right now.

It supports:

- create, read, update, and delete
- mark done or reopen
- due dates
- search and sorting
- grouped display for overdue, today, upcoming, no due date, and done
- clear completed or clear all
- one-step undo after delete
- local persistence through TinyDB

This page is important because it is both a user-facing feature and the first domain the agent can operate on with a real tool.

## Schedule Workspace

The Schedule page is now part of the shipped desktop UI.

It supports:

- month calendar navigation
- create, read, update, and delete events
- range reads through backend API
- local persistence through TinyDB

This extends the app from task-only tracking to task-plus-calendar workflows.

## Config Workspace

The Config page lets the user edit local app settings without leaving the app.

The current editable keys are:

- `backendPort`
- `openaiApiKey`
- `openaiChatModel`
- `openaiEndpoint`
- `motdLanguage`

Saving config updates the local file and synchronizes runtime values to the Python backend. The backend host is fixed to `127.0.0.1`, and Electron keeps `db.json` plus `workspace/` beside `config.json`.

## What The Agent Can Do Today

The current agent integration is intentionally narrow:

- answer chat prompts through the configured model
- inspect local todo items
- create, update, and delete local todo items through approval-gated todo write tools
- list, create, update, and delete schedule events through `manage_schedule`
- inspect files inside the local workspace
- prepare previews for text, image, PDF, audio, or video files inside the local workspace
- create and update text files inside the local workspace through approval-gated file tools
- run PowerShell and Python inside the local workspace after approval
- receive runtime metadata containing current time, host runtime details, and public IP/network info
- receive workspace guidance that points it to uploaded inputs and generated outputs

This is enough to validate tool calling and context injection without pretending the full product already exists.

## What Is Prepared But Not Shipped

Some groundwork already exists in the codebase but is not yet surfaced as a finished product feature.

- backend-friendly domain layering for more routes and tools
- config sync path that can support more runtime options later
- Windows packaging path that bundles the backend Python runtime, documented but still manual to prepare

## What Is Not Implemented Yet

Compared with the original project direction, the following items are still future work:

- campus knowledge retrieval
- reminders and notifications
- external integrations such as Microsoft To Do
- one-click portable runtime preparation for packaged distribution

## Relationship To The Original Proposal

The product direction still follows the same broad goal: help students manage tasks, time, and information from one desktop app.

The main change is technical shape:

- the proposal described `Tauri + React + Python`
- the current implementation is `Electron + vanilla renderer + Python`

Use `docs/presentation/proposal-26s-29.md` to understand the original intent. Use the rest of this documentation set to understand the current repository.
