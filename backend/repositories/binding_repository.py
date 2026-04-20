"""Todo-to-schedule binding repository and TinyDB adapter."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol, TypedDict, cast

from tinydb import Query

from .tinydb.storage import get_database_path, open_table


_TABLE_NAME = "todo_schedule_bindings"


@dataclass(frozen=True, slots=True)
class TodoScheduleBinding:
    id: int
    todo_id: int
    schedule_event_id: int
    link_type: str
    created_at: str
    updated_at: str


class TodoScheduleBindingRecord(TypedDict):
    todo_id: int
    schedule_event_id: int
    link_type: str
    created_at: str
    updated_at: str


class BindingRepository(Protocol):
    def initialize_database(self, db_path: str | Path | None = None) -> Path: ...

    def add_todo_schedule_binding(
        self,
        todo_id: int,
        schedule_event_id: int,
        *,
        link_type: str = "todo_due_event",
        db_path: str | Path | None = None,
    ) -> TodoScheduleBinding: ...

    def get_binding(self, binding_id: int, db_path: str | Path | None = None) -> TodoScheduleBinding | None: ...

    def get_binding_by_todo_id(
        self,
        todo_id: int,
        db_path: str | Path | None = None,
    ) -> TodoScheduleBinding | None: ...

    def get_binding_by_schedule_event_id(
        self,
        schedule_event_id: int,
        db_path: str | Path | None = None,
    ) -> TodoScheduleBinding | None: ...

    def list_todo_schedule_bindings(self, db_path: str | Path | None = None) -> list[TodoScheduleBinding]: ...

    def delete_binding(self, binding_id: int, db_path: str | Path | None = None) -> bool: ...

    def delete_binding_by_todo_id(self, todo_id: int, db_path: str | Path | None = None) -> bool: ...

    def delete_binding_by_schedule_event_id(
        self,
        schedule_event_id: int,
        db_path: str | Path | None = None,
    ) -> bool: ...


class TinyDbBindingRepository:
    def initialize_database(self, db_path: str | Path | None = None) -> Path:
        database_path = get_database_path(db_path)
        with open_table(_TABLE_NAME, database_path):
            pass
        return database_path

    def add_todo_schedule_binding(
        self,
        todo_id: int,
        schedule_event_id: int,
        *,
        link_type: str = "todo_due_event",
        db_path: str | Path | None = None,
    ) -> TodoScheduleBinding:
        timestamp = self._utcnow_iso()
        row: TodoScheduleBindingRecord = {
            "todo_id": todo_id,
            "schedule_event_id": schedule_event_id,
            "link_type": link_type,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

        with open_table(_TABLE_NAME, db_path) as table:
            binding_id = int(table.insert(row))
            stored_row = cast(TodoScheduleBindingRecord, table.get(doc_id=binding_id))

        return self._row_to_binding(binding_id, stored_row)

    def get_binding(self, binding_id: int, db_path: str | Path | None = None) -> TodoScheduleBinding | None:
        with open_table(_TABLE_NAME, db_path) as table:
            row = table.get(doc_id=binding_id)

        if row is None:
            return None
        return self._row_to_binding(binding_id, cast(TodoScheduleBindingRecord, row))

    def get_binding_by_todo_id(
        self,
        todo_id: int,
        db_path: str | Path | None = None,
    ) -> TodoScheduleBinding | None:
        query = Query()
        with open_table(_TABLE_NAME, db_path) as table:
            row = table.get(query.todo_id == todo_id)

        if row is None:
            return None
        return self._row_to_binding(int(row.doc_id), cast(TodoScheduleBindingRecord, row))

    def get_binding_by_schedule_event_id(
        self,
        schedule_event_id: int,
        db_path: str | Path | None = None,
    ) -> TodoScheduleBinding | None:
        query = Query()
        with open_table(_TABLE_NAME, db_path) as table:
            row = table.get(query.schedule_event_id == schedule_event_id)

        if row is None:
            return None
        return self._row_to_binding(int(row.doc_id), cast(TodoScheduleBindingRecord, row))

    def list_todo_schedule_bindings(self, db_path: str | Path | None = None) -> list[TodoScheduleBinding]:
        with open_table(_TABLE_NAME, db_path) as table:
            documents = sorted(table.all(), key=lambda item: item.doc_id)

        return [
            self._row_to_binding(int(document.doc_id), cast(TodoScheduleBindingRecord, document))
            for document in documents
        ]

    def delete_binding(self, binding_id: int, db_path: str | Path | None = None) -> bool:
        with open_table(_TABLE_NAME, db_path) as table:
            removed_ids = table.remove(doc_ids=[binding_id])

        return len(removed_ids) > 0

    def delete_binding_by_todo_id(self, todo_id: int, db_path: str | Path | None = None) -> bool:
        query = Query()
        with open_table(_TABLE_NAME, db_path) as table:
            removed_ids = table.remove(query.todo_id == todo_id)

        return len(removed_ids) > 0

    def delete_binding_by_schedule_event_id(
        self,
        schedule_event_id: int,
        db_path: str | Path | None = None,
    ) -> bool:
        query = Query()
        with open_table(_TABLE_NAME, db_path) as table:
            removed_ids = table.remove(query.schedule_event_id == schedule_event_id)

        return len(removed_ids) > 0

    def _utcnow_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _row_to_binding(self, binding_id: int, row: TodoScheduleBindingRecord) -> TodoScheduleBinding:
        return TodoScheduleBinding(
            id=binding_id,
            todo_id=row["todo_id"],
            schedule_event_id=row["schedule_event_id"],
            link_type=row["link_type"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


binding_repository = TinyDbBindingRepository()
