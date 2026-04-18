"""Context providers for injecting current runtime information into the agent."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from agent_framework import AgentSession, ContextProvider, SessionContext

if TYPE_CHECKING:
    from .db import Todo


class CurrentInfoProvider(ContextProvider):
    """Inject current time and todo summary information into each agent run."""

    def __init__(self, source_id: str = "current_info") -> None:
        super().__init__(source_id)

    async def before_run(
        self,
        *,
        agent: Any,
        session: AgentSession,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        snapshot = _build_current_info_snapshot(session)
        state["snapshot"] = snapshot
        session.state["current_info"] = snapshot
        context.metadata["current_info"] = snapshot
        context.extend_instructions(self.source_id, _format_current_info(snapshot))


def _build_current_info_snapshot(session: AgentSession) -> dict[str, Any]:
    now = datetime.now().astimezone()
    todos, todo_error = _safe_list_todos()

    snapshot = {
        "now": {
            "iso": now.isoformat(),
            "timezone": str(now.tzinfo),
            "weekday": now.strftime("%A"),
            "date": now.date().isoformat(),
            "time": now.strftime("%H:%M"),
        },
        "session": {
            "session_id": session.session_id,
        },
    }

    if todo_error is not None:
        snapshot["todos"] = {
            "available": False,
            "error": todo_error,
        }
        return snapshot

    open_todos = [todo for todo in todos if not todo.is_done]
    overdue_todos = [todo for todo in open_todos if _is_overdue(todo, now)]
    due_today_todos = [todo for todo in open_todos if _is_due_today(todo, now)]
    next_items = [_serialize_todo_brief(todo) for todo in _sort_todos(open_todos)[:5]]

    snapshot["todos"] = {
        "available": True,
        "total": len(todos),
        "open": len(open_todos),
        "done": len(todos) - len(open_todos),
        "overdue": len(overdue_todos),
        "due_today": len(due_today_todos),
        "next_items": next_items,
    }
    return snapshot


def _format_current_info(snapshot: dict[str, Any]) -> str:
    now = snapshot["now"]
    session = snapshot["session"]
    todos = snapshot["todos"]

    lines = [
        "Current runtime context:",
        (
            f"- Time: {now['iso']} ({now['timezone']}, "
            f"{now['weekday']}, local date {now['date']})"
        ),
        f"- Session: {session['session_id']}",
    ]

    if not todos["available"]:
        lines.append(f"- Todos: unavailable ({todos['error']})")
        lines.append(
            "- If the user asks about todos, you may still use manage_todo_list to read them directly."
        )
        return "\n".join(lines)

    lines.append(
        "- Todos: "
        f"{todos['open']} open, {todos['done']} done, "
        f"{todos['overdue']} overdue, {todos['due_today']} due today "
        f"({todos['total']} total)"
    )

    next_items = todos["next_items"]
    if next_items:
        lines.append("- Next todo items:")
        for item in next_items:
            due_at = item["due_at"] or "no due date"
            lines.append(f"  - #{item['id']} {item['title']} (due: {due_at})")
    else:
        lines.append("- Next todo items: none")

    lines.append(
        "- Use this context as a quick summary; call manage_todo_list when the user needs exact todo details or updates."
    )
    return "\n".join(lines)


def _safe_list_todos() -> tuple[list[Todo], str | None]:
    try:
        list_todos = _get_list_todos()
        return list_todos(), None
    except ModuleNotFoundError as exc:
        return [], f"todo storage dependency missing: {exc}"
    except Exception as exc:
        return [], str(exc)


def _get_list_todos() -> Any:
    from .db import list_todos

    return list_todos


def _sort_todos(todos: list[Todo]) -> list[Todo]:
    return sorted(
        todos,
        key=lambda todo: (
            todo.due_at is None,
            _parse_due_at(todo.due_at) or datetime.max.replace(tzinfo=timezone.utc),
            todo.id,
        ),
    )


def _is_overdue(todo: Todo, now: datetime) -> bool:
    due_at = _parse_due_at(todo.due_at)
    return due_at is not None and due_at < now


def _is_due_today(todo: Todo, now: datetime) -> bool:
    due_at = _parse_due_at(todo.due_at)
    return due_at is not None and due_at.date() == now.date()


def _parse_due_at(value: str | None) -> datetime | None:
    if value is None:
        return None

    normalized = value.replace("Z", "+00:00")
    try:
        due_at = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if due_at.tzinfo is None:
        return due_at.astimezone()
    return due_at.astimezone()


def _serialize_todo_brief(todo: Todo) -> dict[str, Any]:
    return {
        "id": todo.id,
        "title": todo.title,
        "due_at": todo.due_at,
        "is_done": todo.is_done,
    }
