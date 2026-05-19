# Design 26S-29

This document provides design deliverables for architecture and UI.
It is a design artifact for report submission and is separate from implementation snapshots.

## 1. Software Architecture

### 1.1 Architecture Diagram

```mermaid
flowchart LR
    subgraph Renderer[Renderer UI]
      UI[Chat / Todo / Schedule / Config]
    end

    subgraph Preload[Preload Bridge]
      Bridge[window.agentAPI / todoAPI / scheduleAPI / configAPI]
    end

    subgraph Electron[Electron Main Process]
      IPC[IPC handlers: agent / todo / schedule / config]
      ConfigStore[Config store + workspace lifecycle]
      BackendProc[Python backend process controller]
    end

    subgraph Backend[FastAPI Backend]
      Routes[HTTP routes + WebSocket route]
      AgentRuntime[Agent runtime + tools + context]
      Services[Service layer]
      Repos[Repository layer]
      TinyDB[(TinyDB)]
    end

    UI --> Bridge --> IPC
    IPC --> Routes
    ConfigStore --> Routes
    BackendProc --> Routes
    Routes --> AgentRuntime
    Routes --> Services --> Repos --> TinyDB
    AgentRuntime --> Services
```

### 1.2 Role Of Each Component

| Component             | Role                                                                      | Notes                                       |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| Renderer UI           | User-facing interaction for chat, todo, schedule, and config              | Keeps no direct backend process control     |
| Preload Bridge        | Trusted boundary exposed to renderer via safe APIs                        | Restricts renderer to explicit capabilities |
| Electron Main Process | App orchestration: IPC, backend process, config file, workspace lifecycle | Central integration point                   |
| FastAPI Routes        | Transport boundary for HTTP and WebSocket                                 | Validation and endpoint contracts           |
| Agent Runtime         | Streaming chat execution, tool calling, approval resume                   | Maintains run/session state                 |
| Services              | Business logic per domain                                                 | Keeps route handlers thin                   |
| Repositories + TinyDB | Persistence abstraction and local data storage                            | Swappable storage boundary                  |

### 1.3 Component Interaction (Primary Flows)

#### Chat Flow (streaming + approval)

```mermaid
sequenceDiagram
    participant U as User
    participant R as Renderer
    participant P as Preload
    participant E as Electron IPC
    participant B as FastAPI WS
    participant A as Agent Runtime

    U->>R: Send prompt
    R->>P: agentAPI.runPrompt(...)
    P->>E: ipc invoke agent:run
    E->>B: Open /api/agent/run (WebSocket)
    B->>A: start run
    A-->>B: update snapshots
    B-->>E: update/done/error events
    E-->>R: agent:stream:event

    alt needs approval
        R->>P: respondApproval(...)
        P->>E: ipc invoke agent:approval
        E->>B: approval_response
        B->>A: resume run
    end

    opt user interrupts
        R->>P: interruptRun(...)
        P->>E: ipc invoke agent:interrupt
        E->>B: close socket / stop run
    end
```

#### Config Flow (file ownership and runtime sync)

```mermaid
sequenceDiagram
    participant R as Renderer Config Page
    participant P as Preload
    participant E as Electron Main
    participant F as config.json (disk)
    participant B as FastAPI /api/config
    participant C as backend/config.py

    R->>P: configAPI.save(draft)
    P->>E: ipc invoke config:save
    E->>F: persist normalized config
    E->>B: POST runtime config
    B->>C: set_config(...)
    C-->>B: in-memory runtime config
    B-->>E: sync success
    E-->>R: saved config
```

### 1.4 Why This Architecture

- Clear runtime boundaries: UI, bridge, orchestration, backend API, business, persistence.
- Strong separation of concerns: each layer has a focused responsibility.
- Reduced coupling: renderer does not manage process lifecycle, files, or direct backend sockets.
- Better testability: routes, services, repositories, and Electron IPC can be tested independently.
- Practical desktop integration: local Python backend process control and runtime sync are centralized in Electron.

### 1.5 Hidden Assumptions And Constraints

- Backend host is local-only (`127.0.0.1`) in this project setup.
- This is a single-user desktop workflow, not a multi-tenant deployment.
- Local persistence is file-based and optimized for project scope, not high-concurrency production loads.
- Workspace artifacts are recreated on app startup by design.
- External model quality and network availability affect chat behavior.

## 2. UI Design

This section is UI design (wireframe-level), not implementation screenshots.
It focuses only on primary interfaces for major features.

### 2.1 Global App Layout

```mermaid
flowchart LR
    subgraph Shell[Desktop Shell]
      Sidebar[Left Sidebar\nNavigation + Status]
      MainArea[Main Content Area]
      Sidebar --- MainArea
    end

    MainArea --> ChatPage[Chat Page]
    MainArea --> TodoPage[Todo Page]
    MainArea --> SchedulePage[Schedule Page]
    MainArea --> ConfigPage[Config Page]
```

### 2.2 Chat UI Design

```mermaid
flowchart TB
    Header[Chat Header: title + short description]
    Messages[Conversation Stream\ntext + tool cards + approval cards + media tiles]
    Composer[Composer\ninput + attachment area + controls]
    Controls[Controls\nAlways Approve / Interrupt / Send]

    Header --> Messages --> Composer --> Controls
```

Design intent:
- Keep conversation and action trace in one place.
- Approval actions must be visible and immediately operable.
- Preserve readability for long assistant outputs.

### 2.3 Todo UI Design

```mermaid
flowchart TB
    Create[Create Task Form\ntitle + due + detail]
    Query[Search + Sort + Filters]
    List[Grouped Task List\noverdue/today/upcoming/no due/done]
    Bulk[Bulk Actions\nclear completed / clear all]

    Create --> Query --> List --> Bulk
```

Design intent:
- Fast capture first, management second.
- Grouping reduces scanning cost for students with many deadlines.

### 2.4 Schedule UI Design

```mermaid
flowchart LR
    Calendar[Month Calendar\nselect date + navigate month]
    RightPane[Right Pane\nAdd Event toggle + Event list]

    Calendar --> RightPane
```

Design intent:
- Date-centric planning with direct event operations.
- Keep event actions near event visibility to reduce context switching.

### 2.5 Config UI Design

```mermaid
flowchart TB
    Fields[Editable Fields\nbackendPort/openai settings/appLanguage]
    Feedback[Validation + Save Status]
    Actions[Save / Discard]

    Fields --> Feedback --> Actions
```

Design intent:
- Keep runtime-sensitive configuration explicit.
- Make unsaved state and save result obvious.

### 2.6 UI Design Notes For Report

- Use this document's diagrams as the UI design artifact baseline.
- If the report requires image files, export each Mermaid diagram as PNG/SVG from Markdown preview.
- Do not use implementation snapshots as replacements for UI design artifacts.
