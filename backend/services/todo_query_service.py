"""Read-oriented todo query helpers and summaries."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..db import Todo
from .todo_service import TodoService, todo_service


class TodoQueryService:
    """Builds read models and runtime summaries from todos."""

    def __init__(self, todo_service_instance: TodoService) -> None:
        self._todo_service = todo_service_instance

    def list_todos(self) -> list[Todo]:
        return self._todo_service.list_todos()

    def build_runtime_snapshot(self, session_id: str) -> dict[str, Any]:
        now = datetime.now().astimezone()
        snapshot = {
            "now": {
                "iso": now.isoformat(),
                "timezone": str(now.tzinfo),
                "weekday": now.strftime("%A"),
                "date": now.date().isoformat(),
                "time": now.strftime("%H:%M"),
            },
            "session": {
                "session_id": session_id,
            },
        }

        try:
            todos = self.list_todos()
        except ModuleNotFoundError as exc:
            snapshot["todos"] = {
                "available": False,
                "error": f"todo storage dependency missing: {exc}",
            }
            return snapshot
        except Exception as exc:
            snapshot["todos"] = {
                "available": False,
                "error": str(exc),
            }
            return snapshot

        open_todos = [todo for todo in todos if not todo.is_done]
        overdue_todos = [todo for todo in open_todos if self._is_overdue(todo, now)]
        due_today_todos = [todo for todo in open_todos if self._is_due_today(todo, now)]
        next_items = [self._serialize_todo_brief(todo) for todo in self._sort_todos(open_todos)[:5]]

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

    def format_runtime_snapshot(self, snapshot: dict[str, Any]) -> str:
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

    def _sort_todos(self, todos: list[Todo]) -> list[Todo]:
        return sorted(
            todos,
            key=lambda todo: (
                todo.due_at is None,
                self._parse_due_at(todo.due_at) or datetime.max.replace(tzinfo=timezone.utc),
                todo.id,
            ),
        )

    def _is_overdue(self, todo: Todo, now: datetime) -> bool:
        due_at = self._parse_due_at(todo.due_at)
        return due_at is not None and due_at < now

    def _is_due_today(self, todo: Todo, now: datetime) -> bool:
        due_at = self._parse_due_at(todo.due_at)
        return due_at is not None and due_at.date() == now.date()

    def _parse_due_at(self, value: str | None) -> datetime | None:
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

    def _serialize_todo_brief(self, todo: Todo) -> dict[str, Any]:
        return {
            "id": todo.id,
            "title": todo.title,
            "due_at": todo.due_at,
            "is_done": todo.is_done,
        }


todo_query_service = TodoQueryService(todo_service)
