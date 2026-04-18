"""TinyDB-backed todo storage."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from tinydb import TinyDB
from tinydb.table import Table

from ..config import get_config


_DEFAULT_DB_PATH = Path(__file__).resolve().parent / "todo.json"
_TABLE_NAME = "todo_list"


@dataclass(frozen=True, slots=True)
class Todo:
    id: int
    title: str
    detail: str
    due_at: str
    is_done: bool
    created_at: str
    updated_at: str


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_database_path(db_path: str | Path | None = None) -> Path:
    resolved = db_path
    if resolved is None:
        resolved = get_config().get("dbPath")

    if resolved is None:
        return _DEFAULT_DB_PATH

    return Path(resolved).expanduser().resolve()


def initialize_database(db_path: str | Path | None = None) -> Path:
    database_path = get_database_path(db_path)
    with _table(database_path):
        pass
    return database_path


def add_todo(
    title: str,
    detail: str,
    due_at: str | datetime,
    db_path: str | Path | None = None,
) -> Todo:
    due_at_value = _serialize_due_at(due_at)
    timestamp = _utcnow_iso()

    with _table(get_database_path(db_path)) as table:
        todo_id = int(
            table.insert(
                {
                    "title": title,
                    "detail": detail,
                    "due_at": due_at_value,
                    "is_done": False,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                }
            )
        )
        table.update({"id": todo_id}, doc_ids=[todo_id])
        row = table.get(doc_id=todo_id)

    return _row_to_todo(todo_id, row)


def update_todo(
    todo_id: int,
    *,
    title: str | None = None,
    detail: str | None = None,
    due_at: str | datetime | None = None,
    is_done: bool | None = None,
    db_path: str | Path | None = None,
) -> Todo:
    updates: dict[str, object] = {}

    if title is not None:
        updates["title"] = title
    if detail is not None:
        updates["detail"] = detail
    if due_at is not None:
        updates["due_at"] = _serialize_due_at(due_at)
    if is_done is not None:
        updates["is_done"] = is_done

    if not updates:
        raise ValueError("At least one todo field must be provided for update.")

    with _table(get_database_path(db_path)) as table:
        existing = table.get(doc_id=todo_id)
        if existing is None:
            raise KeyError(f"Todo item {todo_id} does not exist.")

        if "id" not in existing:
            updates["id"] = todo_id
        if "is_done" not in existing and "is_done" not in updates:
            updates["is_done"] = False
        if "created_at" not in existing:
            updates["created_at"] = _utcnow_iso()

        updates["updated_at"] = _utcnow_iso()
        table.update(updates, doc_ids=[todo_id])
        row = table.get(doc_id=todo_id)

    return _row_to_todo(todo_id, row)


def delete_todo(todo_id: int, db_path: str | Path | None = None) -> bool:
    with _table(get_database_path(db_path)) as table:
        removed_ids = table.remove(doc_ids=[todo_id])

    return len(removed_ids) > 0


def delete_all_todos(db_path: str | Path | None = None) -> int:
    with _table(get_database_path(db_path)) as table:
        removed_count = len(table)
        table.truncate()

    return removed_count


@contextmanager
def _table(database_path: Path) -> Iterator[Table]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    database = TinyDB(str(database_path))
    table = database.table(_TABLE_NAME)

    try:
        yield table
    finally:
        database.close()


def _serialize_due_at(value: str | datetime) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _row_to_todo(todo_id: int, row: dict[str, object] | None) -> Todo:
    if row is None:
        raise RuntimeError("Todo query did not return a row.")

    actual_id = int(row.get("id", todo_id))
    is_done = bool(row.get("is_done", False))
    created_at = str(row.get("created_at", ""))
    updated_at = str(row.get("updated_at", ""))

    return Todo(
        id=actual_id,
        title=str(row["title"]),
        detail=str(row["detail"]),
        due_at=str(row["due_at"]),
        is_done=is_done,
        created_at=created_at,
        updated_at=updated_at,
    )
