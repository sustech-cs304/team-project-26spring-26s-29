"""TinyDB-backed todo repository."""

from datetime import datetime, timezone
from pathlib import Path
from typing import cast

from ..todo_repository import Todo, TodoRecord, TodoUpdate
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
        due_at: str | None = None,
        db_path: str | Path | None = None,
    ) -> Todo:
        timestamp = self._utcnow_iso()
        row: TodoRecord = {
            "title": title,
            "detail": detail,
            "due_at": due_at,
            "is_done": False,
            "completed_at": None,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

        with open_table(_TABLE_NAME, db_path) as table:
            todo_id = int(table.insert(row))
            stored_row = cast(TodoRecord, table.get(doc_id=todo_id))

        return self._row_to_todo(todo_id, stored_row)

    def get_todo(self, todo_id: int, db_path: str | Path | None = None) -> Todo | None:
        with open_table(_TABLE_NAME, db_path) as table:
            row = table.get(doc_id=todo_id)

        if row is None:
            return None
        return self._row_to_todo(todo_id, cast(TodoRecord, row))

    def list_todos(self, db_path: str | Path | None = None) -> list[Todo]:
        with open_table(_TABLE_NAME, db_path) as table:
            documents = sorted(table.all(), key=lambda item: item.doc_id)

        return [self._row_to_todo(int(document.doc_id), cast(TodoRecord, document)) for document in documents]

    def update_todo(self, todo_id: int, updates: TodoUpdate, db_path: str | Path | None = None) -> Todo:
        timestamp = self._utcnow_iso()
        persisted_updates: dict[str, object] = dict(updates)

        if "is_done" in updates:
            persisted_updates["completed_at"] = timestamp if updates["is_done"] else None

        with open_table(_TABLE_NAME, db_path) as table:
            persisted_updates["updated_at"] = timestamp
            table.update(persisted_updates, doc_ids=[todo_id])
            row = cast(TodoRecord, table.get(doc_id=todo_id))

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

    def _row_to_todo(self, todo_id: int, row: TodoRecord) -> Todo:
        return Todo(
            id=todo_id,
            title=row["title"],
            detail=row["detail"],
            due_at=row["due_at"],
            is_done=row["is_done"],
            completed_at=row["completed_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
