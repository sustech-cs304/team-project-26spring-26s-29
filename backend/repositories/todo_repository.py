"""Todo repository contracts and entities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol


UNSET = object()


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


class TodoRepository(Protocol):
    def initialize_database(self, db_path: str | Path | None = None) -> Path: ...

    def add_todo(
        self,
        title: str,
        detail: str,
        due_at: str | datetime | None = None,
        db_path: str | Path | None = None,
    ) -> Todo: ...

    def get_todo(self, todo_id: int, db_path: str | Path | None = None) -> Todo | None: ...

    def list_todos(self, db_path: str | Path | None = None) -> list[Todo]: ...

    def update_todo(
        self,
        todo_id: int,
        *,
        title: str | None = None,
        detail: str | None = None,
        due_at: str | datetime | None | object = UNSET,
        is_done: bool | None = None,
        db_path: str | Path | None = None,
    ) -> Todo: ...

    def delete_todo(self, todo_id: int, db_path: str | Path | None = None) -> bool: ...

    def delete_all_todos(self, db_path: str | Path | None = None) -> int: ...
