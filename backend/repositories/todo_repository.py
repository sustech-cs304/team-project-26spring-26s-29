"""Todo repository contracts and entities."""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, TypedDict


@dataclass(frozen=True, slots=True)
class Todo:
    id: int
    title: str
    detail: str
    due_at: str | None
    is_done: bool
    completed_at: str | None
    created_at: str
    updated_at: str


class TodoUpdate(TypedDict, total=False):
    title: str
    detail: str
    due_at: str | None
    is_done: bool


class TodoRecord(TypedDict):
    title: str
    detail: str
    due_at: str | None
    is_done: bool
    completed_at: str | None
    created_at: str
    updated_at: str


class TodoRepository(Protocol):
    def initialize_database(self, db_path: str | Path | None = None) -> Path: ...

    def add_todo(
        self,
        title: str,
        detail: str,
        due_at: str | None = None,
        db_path: str | Path | None = None,
    ) -> Todo: ...

    def get_todo(self, todo_id: int, db_path: str | Path | None = None) -> Todo | None: ...

    def list_todos(self, db_path: str | Path | None = None) -> list[Todo]: ...

    def update_todo(self, todo_id: int, updates: TodoUpdate, db_path: str | Path | None = None) -> Todo: ...

    def delete_todo(self, todo_id: int, db_path: str | Path | None = None) -> bool: ...

    def delete_all_todos(self, db_path: str | Path | None = None) -> int: ...
