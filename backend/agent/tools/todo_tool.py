"""Todo management tools for the agent."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any

from agent_framework import tool
from pydantic import Field

from ...repositories.todo_repository import TodoUpdate
from ...services import todo_service

if TYPE_CHECKING:
    from ...repositories import Todo

def list_todos() -> dict[str, Any]:
    """Read the local todo list and return ids plus current fields."""
    todos = [_serialize_todo(todo) for todo in todo_service.list_todos()]
    return {
        "action": "list",
        "count": len(todos),
        "todos": todos,
    }


def create_todo(
    title: Annotated[
        str,
        Field(description="Todo title."),
    ],
    detail: Annotated[
        str | None,
        Field(description="Todo detail or notes."),
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
) -> dict[str, Any]:
    """Create a new local todo item."""
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


def update_todo(
    todo_id: Annotated[
        int,
        Field(description="Existing todo id to update."),
    ],
    title: Annotated[
        str | None,
        Field(description="Todo title."),
    ] = None,
    detail: Annotated[
        str | None,
        Field(description="Todo detail or notes."),
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
        Field(description="Set true to remove the current due time."),
    ] = False,
    is_done: Annotated[
        bool | None,
        Field(description="Set true to complete the todo or false to reopen it."),
    ] = None,
) -> dict[str, Any]:
    """Update an existing local todo item."""
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


def delete_todo(
    todo_id: Annotated[
        int,
        Field(description="Existing todo id to delete."),
    ],
) -> dict[str, Any]:
    """Delete a local todo item."""
    deleted = todo_service.delete_todo(todo_id)
    return {
        "action": "delete",
        "message": f"Deleted todo {todo_id}.",
        "deleted": deleted,
        "todo_id": todo_id,
    }


list_todos_tool = tool(
    name="list_todos",
    description="Read the local todo list and return existing todos with their ids.",
    approval_mode="never_require",
)(list_todos)

create_todo_tool = tool(
    name="create_todo",
    description="Create a new local todo item.",
    approval_mode="always_require",
)(create_todo)

update_todo_tool = tool(
    name="update_todo",
    description="Update an existing local todo item by id.",
    approval_mode="always_require",
)(update_todo)

delete_todo_tool = tool(
    name="delete_todo",
    description="Delete an existing local todo item by id.",
    approval_mode="always_require",
)(delete_todo)

TODO_TOOLS = [
    list_todos_tool,
    create_todo_tool,
    update_todo_tool,
    delete_todo_tool,
]


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
