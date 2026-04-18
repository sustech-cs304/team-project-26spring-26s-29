# Current Product Scope

This repository is the current implementation of the Student Productivity Agent project. It is no longer just a proposal, but it is also not the full long-term product yet.

## What Exists Today

The app already provides three working desktop surfaces.

## Chat Workspace

- The renderer sends structured chat inputs through Electron IPC.
- Electron forwards chat requests to the local Python backend.
- The backend streams structured message snapshots over WebSocket.
- The UI renders text, tool calls, approvals, images, and files in real time.

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

## Config Workspace

The Config page lets the user edit local app settings without leaving the app.

The current editable keys are:

- `backendHost`
- `backendPort`
- `dbPath`
- `openaiApiKey`
- `openaiChatModel`
- `openaiEndpoint`

Saving config updates the local file and synchronizes runtime values to the Python backend.

## What The Agent Can Do Today

The current agent integration is intentionally narrow:

- answer chat prompts through the configured model
- inspect local todo items
- create, update, and delete local todo items through approval-gated todo write tools
- receive a small runtime summary containing current time and todo counts

This is enough to validate tool calling and context injection without pretending the full product already exists.

## What Is Prepared But Not Shipped

Some groundwork already exists in the codebase but is not yet surfaced as a finished product feature.

- schedule repository and schedule storage model
- backend-friendly domain layering for more routes and tools
- config sync path that can support more runtime options later

## What Is Not Implemented Yet

Compared with the original project direction, the following items are still future work:

- schedule UI and schedule API
- campus knowledge retrieval
- reminders and notifications
- external integrations such as Microsoft To Do
- packaged distribution and installer workflows

## Relationship To The Original Proposal

The product direction still follows the same broad goal: help students manage tasks, time, and information from one desktop app.

The main change is technical shape:

- the proposal described `Tauri + React + Python`
- the current implementation is `Electron + vanilla renderer + Python`

Use `docs/PROPOSAL.md` to understand the original intent. Use the rest of this documentation set to understand the current repository.
