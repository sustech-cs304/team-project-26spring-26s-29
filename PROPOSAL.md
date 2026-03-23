# Student Productivity Agent Proposal

## Project Overview

SUSTech students manage deadlines, course schedules, campus notices, and personal tasks across several disconnected systems. This project proposes a Student Productivity Agent that brings these workflows into one desktop application. Instead of following a fixed script, the agent will accept natural-language requests, choose tools dynamically, and ask for confirmation before taking important actions. The goal is to reduce schedule fragmentation, improve access to campus information, and help students stay organized.

## Functional Requirements

### FR1. Chat-Centered Workspace

The system shall provide a chat interface as the main entry point for user requests.

- Users shall be able to ask for planning, reminders, campus information, and task updates in natural language.
- The interface shall display agent replies, key tool actions, and approval requests in one workspace.
- The GUI shall include interaction, result display, and a lightweight agent activity trace.

### FR2. Unified Schedule and Task Management

The system shall combine course schedules, deadlines, and personal tasks in a single workspace.

- The system shall provide a schedule view that the agent can read and update.
- The agent shall support temporary schedule changes and planning for the next semester.
- The system shall provide a task list for homework, projects, exams, and personal TODOs.
- The system may integrate with Microsoft To Do for external task synchronization.

### FR3. Campus Knowledge Assistant

The system shall retrieve information from trusted SUSTech sources.

- The initial knowledge base shall include the official academic calendar and selected public campus documents.
- The agent shall answer campus-related questions with concise, grounded responses.
- Blackboard-related data may be added when policy and integration constraints allow.

### FR4. Personal Planning and Notifications

The system shall help students plan their workload and stay aware of important events.

- The agent shall analyze schedules and tasks to suggest priorities or weekly plans.
- The system shall send notifications for reminders, schedule changes, and agent-triggered updates.
- Planning results shall reflect user preferences when such preferences are available.

### FR5. Safe Automation

The system shall support limited autonomous actions through approved tools.

- The agent may run task-oriented actions in a terminal or automation mode.
- Any write action or external side effect shall require explicit user confirmation.
- The system shall record major actions so the user can review what the agent did.

## Non-Functional Requirements

### NFR1. Usability

- The interface shall be clean, lightweight, and easy for students to learn.
- The application shall provide clear pages for chat, schedule, tasks, and settings.
- The design shall support dark mode.

### NFR2. Safety and Security

- The agent shall be constrained to approved tools, permissions, and data sources.
- The system shall protect user data and privacy, especially when using external APIs or services.

### NFR3. Performance

- The application shall remain responsive during agent execution.
- The architecture shall reduce unnecessary latency and token usage where possible.

## Technical Requirements

- The application shall use Tauri for the desktop framework and React for the frontend.
- A Python backend shall implement the agentic loop, tool calling, and service integrations.
- The agent layer may use a framework such as Microsoft Agent Framework.
- SQLite shall store schedules, tasks, preferences, and local metadata.
- The system shall use the operating system notification API for reminders.
- The chat capability shall use OpenAI API or an equivalent LLM service.

## Data Requirements

- Official SUSTech calendar data and selected public campus documents shall be used as trusted sources.
- User-created schedules, tasks, and preference settings shall be stored locally.
- Optional external task data may be synced from supported services such as Microsoft To Do.
- Blackboard-related data is not guaranteed in the first version because of school policy and integration limits.
