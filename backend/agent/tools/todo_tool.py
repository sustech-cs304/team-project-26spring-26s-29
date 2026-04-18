"""Todo management tools for the agent."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any, Literal

from agent_framework import tool
from pydantic import Field

from ...repositories.todo_repository import TodoUpdate
from ...services import todo_service

if TYPE_CHECKING:
    from ...repositories import Todo

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
            title=title,
            detail="" if detail is None else detail,
            due_at=due_at,
        )
        return {
            "action": "create",
            "message": f"Created todo {todo.id}.",
            "todo": _serialize_todo(todo),
        }

    if action == "update":
        updates: TodoUpdate = {}
        if title is not None:
            updates["title"] = title
        if detail is not None:
            updates["detail"] = detail
        if clear_due_at:
            updates["due_at"] = None
        elif due_at is not None:
            updates["due_at"] = due_at
        if is_done is not None:
            updates["is_done"] = is_done

        todo = todo_service.update_todo(todo_id, updates)
        return {
            "action": "update",
            "message": f"Updated todo {todo.id}.",
            "todo": _serialize_todo(todo),
        }

    if action == "delete":
        deleted = todo_service.delete_todo(todo_id)
        return {
            "action": "delete",
            "message": f"Deleted todo {todo_id}.",
            "deleted": deleted,
            "todo_id": todo_id,
        }

    return {
        "action": action,
        "message": f"Unsupported todo action: {action}.",
        "deleted": False,
    }


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
