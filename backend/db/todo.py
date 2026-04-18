"""SQLite-backed todo storage."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator


_DEFAULT_DB_PATH = Path(__file__).resolve().parent / "todo.sqlite3"


@dataclass(frozen=True, slots=True)
class Todo:
    id: int
    title: str
    detail: str
    due_at: str


def get_database_path(db_path: str | Path | None = None) -> Path:
    if db_path is None:
        return _DEFAULT_DB_PATH
    return Path(db_path).expanduser().resolve()


def initialize_database(db_path: str | Path | None = None) -> Path:
    database_path = get_database_path(db_path)
    with _connect(database_path):
        pass
    return database_path


def add_todo(
    title: str,
    detail: str,
    due_at: str | datetime,
    db_path: str | Path | None = None,
) -> Todo:
    due_at_value = _serialize_due_at(due_at)

    with _connect(get_database_path(db_path)) as connection:
        cursor = connection.execute(
            """
            INSERT INTO todo_list (title, detail, due_at)
            VALUES (?, ?, ?)
            """,
            (title, detail, due_at_value),
        )
        row = connection.execute(
            """
            SELECT id, title, detail, due_at
            FROM todo_list
            WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()

    return _row_to_todo(row)


def update_todo(
    todo_id: int,
    *,
    title: str | None = None,
    detail: str | None = None,
    due_at: str | datetime | None = None,
    db_path: str | Path | None = None,
) -> Todo:
    assignments: list[str] = []
    values: list[str | int] = []

    if title is not None:
        assignments.append("title = ?")
        values.append(title)
    if detail is not None:
        assignments.append("detail = ?")
        values.append(detail)
    if due_at is not None:
        assignments.append("due_at = ?")
        values.append(_serialize_due_at(due_at))

    if not assignments:
        raise ValueError("At least one todo field must be provided for update.")

    with _connect(get_database_path(db_path)) as connection:
        existing = connection.execute(
            "SELECT id FROM todo_list WHERE id = ?",
            (todo_id,),
        ).fetchone()
        if existing is None:
            raise KeyError(f"Todo item {todo_id} does not exist.")

        values.append(todo_id)
        connection.execute(
            f"UPDATE todo_list SET {', '.join(assignments)} WHERE id = ?",
            values,
        )
        row = connection.execute(
            """
            SELECT id, title, detail, due_at
            FROM todo_list
            WHERE id = ?
            """,
            (todo_id,),
        ).fetchone()

    return _row_to_todo(row)


def delete_todo(todo_id: int, db_path: str | Path | None = None) -> bool:
    with _connect(get_database_path(db_path)) as connection:
        cursor = connection.execute(
            "DELETE FROM todo_list WHERE id = ?",
            (todo_id,),
        )

    return cursor.rowcount > 0


def delete_all_todos(db_path: str | Path | None = None) -> int:
    with _connect(get_database_path(db_path)) as connection:
        cursor = connection.execute("DELETE FROM todo_list")

    return cursor.rowcount


@contextmanager
def _connect(database_path: Path) -> Iterator[sqlite3.Connection]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    _initialize_schema(connection)

    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def _initialize_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS todo_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            detail TEXT NOT NULL,
            due_at TEXT NOT NULL
        )
        """
    )


def _serialize_due_at(value: str | datetime) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _row_to_todo(row: sqlite3.Row | None) -> Todo:
    if row is None:
        raise RuntimeError("Todo query did not return a row.")

    return Todo(
        id=row["id"],
        title=row["title"],
        detail=row["detail"],
        due_at=row["due_at"],
    )
