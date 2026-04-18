"""TinyDB-backed todo repository."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from ..todo_repository import UNSET, Todo
from .storage import get_database_path, open_table


_TABLE_NAME = "todo_list"


class TinyDbTodoRepository:
    def initialize_database(self, db_path: str | Path | None = None) -> Path:
        database_path = get_database_path(db_path)
        with open_table(_TABLE_NAME, database_path):
            pass
        return database_path

    def add_todo(
        self,
        title: str,
        detail: str,
        due_at: str | datetime | None = None,
        db_path: str | Path | None = None,
    ) -> Todo:
        due_at_value = self._serialize_due_at(due_at)
        timestamp = self._utcnow_iso()

        with open_table(_TABLE_NAME, db_path) as table:
            todo_id = int(
                table.insert(
                    {
                        "title": title,
                        "detail": detail,
                        "due_at": due_at_value,
                        "is_done": False,
                        "completed_at": None,
                        "created_at": timestamp,
                        "updated_at": timestamp,
                    }
                )
            )
            row = table.get(doc_id=todo_id)

        return self._row_to_todo(todo_id, row)

    def get_todo(self, todo_id: int, db_path: str | Path | None = None) -> Todo | None:
        with open_table(_TABLE_NAME, db_path) as table:
            row = table.get(doc_id=todo_id)

        if row is None:
            return None
        return self._row_to_todo(todo_id, row)

    def list_todos(self, db_path: str | Path | None = None) -> list[Todo]:
        with open_table(_TABLE_NAME, db_path) as table:
            documents = sorted(table.all(), key=lambda item: item.doc_id)

        return [self._row_to_todo(int(document.doc_id), document) for document in documents]

    def update_todo(
        self,
        todo_id: int,
        *,
        title: str | None = None,
        detail: str | None = None,
        due_at: str | datetime | None | object = UNSET,
        is_done: bool | None = None,
        db_path: str | Path | None = None,
    ) -> Todo:
        updates: dict[str, object] = {}

        if title is not None:
            updates["title"] = title
        if detail is not None:
            updates["detail"] = detail
        if due_at is not UNSET:
            updates["due_at"] = self._serialize_due_at(due_at)
        if is_done is not None:
            updates["is_done"] = is_done
            updates["completed_at"] = self._utcnow_iso() if is_done else None

        if not updates:
            raise ValueError("At least one todo field must be provided for update.")

        with open_table(_TABLE_NAME, db_path) as table:
            existing = table.get(doc_id=todo_id)
            if existing is None:
                raise KeyError(f"Todo item {todo_id} does not exist.")

            if "is_done" not in existing and "is_done" not in updates:
                updates["is_done"] = False
            if "due_at" not in existing and "due_at" not in updates:
                updates["due_at"] = None
            if "completed_at" not in existing and "completed_at" not in updates:
                updates["completed_at"] = None
            if "created_at" not in existing:
                updates["created_at"] = self._utcnow_iso()

            updates["updated_at"] = self._utcnow_iso()
            table.update(updates, doc_ids=[todo_id])
            row = table.get(doc_id=todo_id)

        return self._row_to_todo(todo_id, row)

    def delete_todo(self, todo_id: int, db_path: str | Path | None = None) -> bool:
        with open_table(_TABLE_NAME, db_path) as table:
            removed_ids = table.remove(doc_ids=[todo_id])

        return len(removed_ids) > 0

    def delete_all_todos(self, db_path: str | Path | None = None) -> int:
        with open_table(_TABLE_NAME, db_path) as table:
            removed_count = len(table)
            table.truncate()

        return removed_count

    def _utcnow_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _serialize_due_at(self, value: str | datetime | None | object) -> str | None:
        if value is UNSET:
            return None
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    def _row_to_todo(self, todo_id: int, row: dict[str, object] | None) -> Todo:
        if row is None:
            raise RuntimeError("Todo query did not return a row.")

        is_done = bool(row.get("is_done", False))
        due_at_raw = row.get("due_at")
        completed_at_raw = row.get("completed_at")
        created_at_raw = row.get("created_at")
        updated_at_raw = row.get("updated_at")

        return Todo(
            id=todo_id,
            title=str(row["title"]),
            detail=str(row["detail"]),
            due_at=None if due_at_raw is None else str(due_at_raw),
            is_done=is_done,
            completed_at=None if completed_at_raw is None else str(completed_at_raw),
            created_at="" if created_at_raw is None else str(created_at_raw),
            updated_at="" if updated_at_raw is None else str(updated_at_raw),
        )
