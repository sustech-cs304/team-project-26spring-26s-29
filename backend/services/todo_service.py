"""Business operations for todo management."""

from typing import Literal

from ..repositories import ScheduleRepository, Todo, TodoRepository, TodoUpdate, schedule_repository, todo_repository
from ..repositories.binding_repository import BindingRepository, binding_repository
from .todo_schedule_binding_service import (
    DEFAULT_SCHEDULE_DURATION_MINUTES,
    bind_after_todo_created,
    cleanup_after_todo_deleted,
    sync_after_todo_upserted,
)


class TodoService:
    """Owns todo mutations and domain-facing CRUD behavior."""

    def __init__(
        self,
        repository: TodoRepository,
        *,
        schedule_repo: ScheduleRepository = schedule_repository,
        binding_repo: BindingRepository = binding_repository,
        schedule_duration_minutes: int = DEFAULT_SCHEDULE_DURATION_MINUTES,
    ) -> None:
        self._repository = repository
        self._schedule_repo = schedule_repo
        self._binding_repo = binding_repo
        self._schedule_duration_minutes = schedule_duration_minutes

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
        bind_after_todo_created(
            todo,
            schedule_duration_minutes=self._schedule_duration_minutes,
            schedule_repo=self._schedule_repo,
            binding_repo=self._binding_repo,
        )
        return todo

    def update_todo(self, todo_id: int, updates: TodoUpdate) -> Todo:
        todo = self._repository.update_todo(todo_id, updates)
        sync_after_todo_upserted(
            todo,
            schedule_duration_minutes=self._schedule_duration_minutes,
            schedule_repo=self._schedule_repo,
            binding_repo=self._binding_repo,
        )
        return todo

    def delete_todo(self, todo_id: int) -> bool:
        deleted = self._repository.delete_todo(todo_id)
        if deleted:
            cleanup_after_todo_deleted(
                todo_id,
                schedule_repo=self._schedule_repo,
                binding_repo=self._binding_repo,
            )
        return deleted

    def clear_todos(self, scope: Literal["all", "completed"]) -> int:
        deleted_count = 0
        for item in self.list_todos():
            if scope == "all" or item.is_done:
                if self.delete_todo(item.id):
                    deleted_count += 1

        return deleted_count


todo_service = TodoService(todo_repository)
