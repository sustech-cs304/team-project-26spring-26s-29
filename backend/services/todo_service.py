"""Business operations for todo management."""

from typing import Literal

from ..repositories import Todo, TodoRepository, TodoUpdate, todo_repository
from .todo_schedule_binding_service import bind_after_todo_created


class TodoService:
    """Owns todo mutations and domain-facing CRUD behavior."""

    def __init__(self, repository: TodoRepository) -> None:
        self._repository = repository

    def list_todos(self) -> list[Todo]:
        return self._repository.list_todos()

    def get_todo(self, todo_id: int) -> Todo | None:
        return self._repository.get_todo(todo_id)

    def create_todo(
        self,
        *,
        title: str,
        detail: str,
        due_at: str | None = None,
    ) -> Todo:
        todo = self._repository.add_todo(title=title, detail=detail, due_at=due_at)
        bind_after_todo_created(todo)
        return todo

    def update_todo(self, todo_id: int, updates: TodoUpdate) -> Todo:
        return self._repository.update_todo(todo_id, updates)

    def delete_todo(self, todo_id: int) -> bool:
        return self._repository.delete_todo(todo_id)

    def clear_todos(self, scope: Literal["all", "completed"]) -> int:
        if scope == "all":
            return self._repository.delete_all_todos()

        deleted_count = 0
        for item in self.list_todos():
            if item.is_done and self.delete_todo(item.id):
                deleted_count += 1

        return deleted_count


todo_service = TodoService(todo_repository)
