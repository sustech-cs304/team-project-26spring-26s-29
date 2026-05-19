# Feature Requirements

This document defines the simplified Release 1 scope. The goal is a small local
desktop assistant for SUSTech students, not a full campus platform.

The todo, schedule, chat, and local configuration features are generic student
productivity surfaces. The NanKe Manual (南科手册) corpus and other campus
knowledge content are SUSTech-specific proprietary/domain content.

`docs/presentation/proposal-26s-29.md` remains the original proposal archive.

## FR1. Local Chat Assistant

The app shall provide a chat page backed by the local Python backend.

- Users can submit messages and receive streamed assistant responses.
- Assistant text can render Markdown and math.
- Users can attach files for a chat run.
- Tool calls that may change local state require user approval.
- Users can interrupt an in-progress run.

## FR2. Task Management

The app shall provide local task management.

- Users can create, read, update, delete, complete, and reopen tasks.
- Tasks can have optional due times and details.
- Users can search, sort, filter, bulk clear, and undo a recent delete.
- Tasks persist locally through TinyDB.
- The assistant can read tasks and can request approval to change tasks.

## FR3. Schedule Management

The app shall provide local schedule-event management.

- Users can create, read, update, and delete schedule events.
- Events have title, optional details, and start/end time fields.
- Users can browse events through a month calendar.
- Schedule events persist locally through TinyDB.
- The assistant can read schedule events and can request approval to change them.

## FR4. SUSTech Manual Corpus

The app shall support a SUSTech-oriented knowledge corpus.

- The corpus can be built from bundled NanKe Manual and related SUSTech source materials.
- The corpus can be validated during development and packaging.
- Campus-specific answers should be grounded in the SUSTech corpus when available.
- Generic todo and schedule behavior must not depend on SUSTech-only content.

## FR5. Local Configuration

The app shall let users edit development-time runtime settings without leaving the desktop app.

- Users can edit backend port, model settings, endpoint, API key, and message language.
- Electron stores config on disk.
- Electron syncs runtime settings to the Python backend.
- Electron restarts the backend when the backend port changes.

## Out Of Scope For Release 1

- reminders and notifications
- Blackboard or Microsoft To Do integration
- multi-device sync
- cloud accounts
- fully automated actions without user approval
