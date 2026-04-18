"""Business operations for todo management."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from ..db import Todo, add_todo, delete_all_todos, delete_todo, get_todo, list_todos, update_todo


UNSET = object()


class TodoService:
    """Owns todo mutations and domain-facing CRUD behavior."""

    def list_todos(self) -> list[Todo]:
        return list_todos()

    def get_todo(self, todo_id: int) -> Todo | None:
        return get_todo(todo_id)

    def create_todo(
        self,
        *,
        title: str,
        detail: str,
        due_at: str | datetime | None = None,
    ) -> Todo:
        return add_todo(title=title, detail=detail, due_at=due_at)

    def update_todo(
        self,
        todo_id: int,
        *,
        title: str | None = None,
        detail: str | None = None,
        due_at: str | datetime | None | object = UNSET,
        is_done: bool | None = None,
    ) -> Todo:
        updates: dict[str, object] = {}

        if title is not None:
            updates["title"] = title
        if detail is not None:
            updates["detail"] = detail
        if due_at is not UNSET:
            updates["due_at"] = due_at
        if is_done is not None:
            updates["is_done"] = is_done

        return update_todo(todo_id, **updates)

    def delete_todo(self, todo_id: int) -> bool:
        return delete_todo(todo_id)

    def clear_todos(self, scope: Literal["all", "completed"]) -> int:
        if scope == "all":
            return delete_all_todos()
        if scope != "completed":
            raise ValueError(f"Unsupported todo clear scope: {scope}.")

        deleted_count = 0
        for item in self.list_todos():
            if item.is_done and self.delete_todo(item.id):
                deleted_count += 1

        return deleted_count


todo_service = TodoService()
