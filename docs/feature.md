# Feature Requirements (Working Draft)

This document records the revised functional requirements used for implementation planning and review.
`docs/presentation/proposal-26s-29.md` remains an archive of the original proposal text.

## FR1. Chat-Centered Workspace

The system shall provide a chat interface as the primary user entry point for agent interaction.

- Users shall be able to submit natural-language requests and receive assistant responses in the same conversation view.
- Each conversation turn shall show a visible execution state (`running`, `needs_approval`, `completed`, `error`, or `interrupted`).
- The chat UI shall display tool calls, tool outcomes, and approval requests inline with the related assistant turn.
- For each pending approval request, the user shall be able to explicitly approve or reject from the GUI.

## FR2. Unified Schedule and Task Management

The system shall provide one workspace that manages both tasks and schedule events.

- The system shall provide task CRUD operations, completion state updates, and due-time tracking.
- The system shall provide schedule-event CRUD operations with start/end time fields.
- The agent shall be able to read and modify both tasks and schedule events through approved backend tools.
- The workspace shall persist tasks and schedule events in local storage.
- External sync (for example Microsoft To Do) is an optional extension and is out of Release-1 scope.

## FR3. Campus Knowledge Assistant

The system shall answer campus-related questions using trusted SUSTech sources.

- The initial source set shall include the official academic calendar and selected public campus documents.
- For campus-information answers, the system shall return source references (document name or URL) in the response.
- If the requested answer is not available in configured sources, the system shall explicitly report "not found in available sources" instead of fabricating facts.
- Blackboard data integration is optional and out of Release-1 scope unless policy and integration access are available.

## FR4. Personal Planning and Notifications

The system shall provide planning support and reminder notifications based on user tasks and schedule events.

- The agent shall generate planning suggestions (for example daily or weekly priorities) from existing task and schedule data.
- The user shall be able to create a reminder for a task or schedule event with a specified trigger time.
- The system shall issue local notifications when a reminder trigger is reached.
- If user preference settings are configured (for example quiet hours or reminder lead time), reminder behavior shall follow those settings.

## FR5. Safe Automation

The system shall support bounded automation through a permissioned tool model.

- The system shall distinguish read-only actions from side-effect actions (file writes, command execution, or external updates).
- Any side-effect action shall require explicit user approval before execution.
- The user shall be able to interrupt an in-progress agent run.
- The system shall keep an action trace containing at least: timestamp, action name, approval decision, and execution outcome.
