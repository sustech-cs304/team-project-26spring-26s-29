"""Compatibility wrappers for todo storage helpers."""

from pathlib import Path
from typing import cast

from ..repositories import Todo, TodoUpdate, todo_repository
from ..repositories.tinydb.storage import get_database_path


_UNSET = object()


def initialize_database(db_path: str | Path | None = None) -> Path:
    return todo_repository.initialize_database(db_path)


def add_todo(
    title: str,
    detail: str,
    due_at: str | None = None,
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
    due_at: str | None | object = _UNSET,
    is_done: bool | None = None,
    db_path: str | Path | None = None,
) -> Todo:
    updates: TodoUpdate = {}
    if title is not None:
        updates["title"] = title
    if detail is not None:
        updates["detail"] = detail
    if due_at is not _UNSET:
        updates["due_at"] = cast(str | None, due_at)
    if is_done is not None:
        updates["is_done"] = is_done

    return todo_repository.update_todo(todo_id, updates, db_path=db_path)


def delete_todo(todo_id: int, db_path: str | Path | None = None) -> bool:
    return todo_repository.delete_todo(todo_id, db_path)


def delete_all_todos(db_path: str | Path | None = None) -> int:
    return todo_repository.delete_all_todos(db_path)
