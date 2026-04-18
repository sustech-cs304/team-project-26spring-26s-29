"""Compatibility wrappers for todo storage helpers."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ..repositories import UNSET, Todo, todo_repository
from ..repositories.tinydb.storage import get_database_path


def initialize_database(db_path: str | Path | None = None) -> Path:
    return todo_repository.initialize_database(db_path)


def add_todo(
    title: str,
    detail: str,
    due_at: str | datetime | None = None,
    db_path: str | Path | None = None,
) -> Todo:
    return todo_repository.add_todo(title, detail, due_at, db_path)


def get_todo(todo_id: int, db_path: str | Path | None = None) -> Todo | None:
    return todo_repository.get_todo(todo_id, db_path)


def list_todos(db_path: str | Path | None = None) -> list[Todo]:
    return todo_repository.list_todos(db_path)


def update_todo(
    todo_id: int,
    *,
    title: str | None = None,
    detail: str | None = None,
    due_at: str | datetime | None | object = UNSET,
    is_done: bool | None = None,
    db_path: str | Path | None = None,
) -> Todo:
    return todo_repository.update_todo(
        todo_id,
        title=title,
        detail=detail,
        due_at=due_at,
        is_done=is_done,
        db_path=db_path,
    )


def delete_todo(todo_id: int, db_path: str | Path | None = None) -> bool:
    return todo_repository.delete_todo(todo_id, db_path)


def delete_all_todos(db_path: str | Path | None = None) -> int:
    return todo_repository.delete_all_todos(db_path)
