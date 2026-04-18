"""Todo management tools for the agent."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal

from agent_framework import tool
from pydantic import Field

from ..services import UNSET, todo_service

if TYPE_CHECKING:
    from ..db import Todo

TodoAction = Literal["list", "create", "update", "delete"]


def manage_todo_list(
    action: Annotated[
        TodoAction,
        Field(description="Which todo action to run: list, create, update, or delete."),
    ],
    todo_id: Annotated[
        int | None,
        Field(description="Existing todo id. Required for update and delete."),
    ] = None,
    title: Annotated[
        str | None,
        Field(description="Todo title. Required for create and optional for update."),
    ] = None,
    detail: Annotated[
        str | None,
        Field(description="Todo detail or notes. Optional for create and update."),
    ] = None,
    due_at: Annotated[
        str | None,
        Field(
            description=(
                "Optional due time in ISO 8601 format, for example "
                "2026-04-18T09:00:00+08:00."
            )
        ),
    ] = None,
    clear_due_at: Annotated[
        bool,
        Field(description="Set true during update to remove the current due time."),
    ] = False,
    is_done: Annotated[
        bool | None,
        Field(description="Set during update to mark a todo complete or reopen it."),
    ] = None,
) -> dict[str, Any]:
    """Read the todo list or create, update, and delete local todo items."""
    if action == "list":
        todos = [_serialize_todo(todo) for todo in todo_service.list_todos()]
        return {
            "action": "list",
            "count": len(todos),
            "todos": todos,
        }

    if action == "create":
        todo = todo_service.create_todo(
            title=_normalize_title(title),
            detail=_normalize_detail(detail),
            due_at=_normalize_due_at(due_at),
        )
        return {
            "action": "create",
            "message": f"Created todo {todo.id}.",
            "todo": _serialize_todo(todo),
        }

    if action == "update":
        todo_id_value = _require_todo_id(todo_id)
        if clear_due_at and due_at is not None:
            raise ValueError("Provide due_at or clear_due_at for update, not both.")

        updates: dict[str, Any] = {}
        if title is not None:
            updates["title"] = _normalize_title(title)
        if detail is not None:
            updates["detail"] = _normalize_detail(detail)
        if clear_due_at:
            updates["due_at"] = None
        elif due_at is not None:
            updates["due_at"] = _normalize_due_at(due_at)
        else:
            updates["due_at"] = UNSET
        if is_done is not None:
            updates["is_done"] = is_done

        if (
            updates.get("title") is None
            and updates.get("detail") is None
            and updates.get("due_at", UNSET) is UNSET
            and updates.get("is_done") is None
        ):
            raise ValueError("Update requires at least one field to change.")

        todo = todo_service.update_todo(todo_id_value, **updates)
        return {
            "action": "update",
            "message": f"Updated todo {todo.id}.",
            "todo": _serialize_todo(todo),
        }

    if action == "delete":
        todo_id_value = _require_todo_id(todo_id)
        deleted = todo_service.delete_todo(todo_id_value)
        if not deleted:
            raise KeyError(f"Todo item {todo_id_value} does not exist.")
        return {
            "action": "delete",
            "message": f"Deleted todo {todo_id_value}.",
            "deleted": True,
            "todo_id": todo_id_value,
        }

    raise ValueError(f"Unsupported todo action: {action}.")


todo_tool = tool(
    name="manage_todo_list",
    description=(
        "Read the local todo list or create, update, and delete todo items. "
        "Use action='list' to inspect existing todos and their ids. "
        "Use action='create' to add a new todo. "
        "Use action='update' to change title, detail, due_at, or completion status. "
        "Use action='delete' to remove a todo by id."
    ),
    approval_mode="never_require",
)(manage_todo_list)

TODO_TOOLS = [todo_tool]


def _normalize_title(value: str | None) -> str:
    if value is None:
        raise ValueError("title is required.")

    normalized = value.strip()
    if not normalized:
        raise ValueError("title must not be empty.")
    return normalized


def _normalize_detail(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip()


def _normalize_due_at(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).isoformat()
    except ValueError as exc:
        raise ValueError(
            "due_at must be a valid ISO 8601 datetime, for example 2026-04-18T09:00:00+08:00."
        ) from exc


def _require_todo_id(todo_id: int | None) -> int:
    if todo_id is None:
        raise ValueError("todo_id is required for this action.")
    return todo_id


def _serialize_todo(todo: Todo) -> dict[str, Any]:
    return {
        "id": todo.id,
        "title": todo.title,
        "detail": todo.detail,
        "due_at": todo.due_at,
        "is_done": todo.is_done,
        "completed_at": todo.completed_at,
        "created_at": todo.created_at,
        "updated_at": todo.updated_at,
    }
