"""TinyDB-backed Blackboard sync repository."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

from tinydb import Query

from ..blackboard_repository import (
    BlackboardRemoteItem,
    BlackboardRemoteItemRecord,
    BlackboardSuggestion,
    BlackboardSuggestionRecord,
    SuggestionAction,
    SuggestionStatus,
)
from .storage import get_database_path, open_table


_STATE_TABLE = "blackboard_state"
_ITEM_TABLE = "blackboard_remote_items"
_SUGGESTION_TABLE = "blackboard_suggestions"
class TinyDbBlackboardRepository:
    def initialize_database(self, db_path: str | Path | None = None) -> Path:
        database_path = get_database_path(db_path)
        with open_table(_STATE_TABLE, database_path):
            pass
        with open_table(_ITEM_TABLE, database_path):
            pass
        with open_table(_SUGGESTION_TABLE, database_path):
            pass
        return database_path

    def get_state(self, db_path: str | Path | None = None) -> dict[str, Any]:
        with open_table(_STATE_TABLE, db_path) as table:
            row = table.all()[0] if table.all() else None
        return dict(row or self._default_state())

    def update_state(self, updates: dict[str, Any], db_path: str | Path | None = None) -> dict[str, Any]:
        next_state = {**self.get_state(db_path), **updates}
        next_state["updated_at"] = self._utcnow_iso()
        with open_table(_STATE_TABLE, db_path) as table:
            table.truncate()
            table.insert(next_state)
        return next_state

    def upsert_remote_item(
        self,
        record: BlackboardRemoteItemRecord,
        db_path: str | Path | None = None,
    ) -> tuple[BlackboardRemoteItem, bool]:
        item_query = Query()
        with open_table(_ITEM_TABLE, db_path) as table:
            existing = table.get(item_query.source_key == record["source_key"])
            changed = existing is None or existing.get("raw_hash") != record["raw_hash"]
            if existing is None:
                doc_id = int(table.insert(record))
            else:
                doc_id = int(existing.doc_id)
                table.update(record, doc_ids=[doc_id])
            stored = cast(BlackboardRemoteItemRecord, table.get(doc_id=doc_id))

        return self._row_to_remote_item(doc_id, stored), changed

    def mark_missing_items(
        self,
        seen_source_keys: set[str],
        timestamp: str,
        db_path: str | Path | None = None,
    ) -> None:
        with open_table(_ITEM_TABLE, db_path) as table:
            for document in table.all():
                if document.get("source_key") in seen_source_keys:
                    continue
                missing_count = int(document.get("missing_count") or 0) + 1
                updates: dict[str, Any] = {"missing_count": missing_count}
                if missing_count >= 3 and document.get("deleted_at") is None:
                    updates["deleted_at"] = timestamp
                table.update(updates, doc_ids=[document.doc_id])

    def list_remote_items(self, db_path: str | Path | None = None) -> list[BlackboardRemoteItem]:
        with open_table(_ITEM_TABLE, db_path) as table:
            documents = sorted(table.all(), key=lambda item: item.doc_id)
        return [
            self._row_to_remote_item(int(document.doc_id), cast(BlackboardRemoteItemRecord, document))
            for document in documents
        ]

    def find_suggestion(
        self,
        source_key: str,
        source_hash: str,
        action: SuggestionAction,
        title: str,
        db_path: str | Path | None = None,
    ) -> BlackboardSuggestion | None:
        suggestion_query = Query()
        with open_table(_SUGGESTION_TABLE, db_path) as table:
            row = table.get(
                (suggestion_query.source_key == source_key)
                & (suggestion_query.source_hash == source_hash)
                & (suggestion_query.action == action)
                & (suggestion_query.title == title)
            )
        if row is None:
            return None
        return self._row_to_suggestion(int(row.doc_id), cast(BlackboardSuggestionRecord, row))

    def add_suggestion(
        self,
        record: BlackboardSuggestionRecord,
        db_path: str | Path | None = None,
    ) -> BlackboardSuggestion:
        with open_table(_SUGGESTION_TABLE, db_path) as table:
            suggestion_id = int(table.insert(record))
            stored = cast(BlackboardSuggestionRecord, table.get(doc_id=suggestion_id))
        return self._row_to_suggestion(suggestion_id, stored)

    def list_suggestions(
        self,
        status: SuggestionStatus | None = None,
        db_path: str | Path | None = None,
    ) -> list[BlackboardSuggestion]:
        with open_table(_SUGGESTION_TABLE, db_path) as table:
            if status is None:
                documents = table.all()
            else:
                suggestion_query = Query()
                documents = table.search(suggestion_query.status == status)
            documents = sorted(documents, key=lambda item: item.doc_id)
        return [
            self._row_to_suggestion(int(document.doc_id), cast(BlackboardSuggestionRecord, document))
            for document in documents
        ]

    def update_suggestion(
        self,
        suggestion_id: int,
        updates: dict[str, Any],
        db_path: str | Path | None = None,
    ) -> BlackboardSuggestion:
        with open_table(_SUGGESTION_TABLE, db_path) as table:
            table.update({**updates, "updated_at": self._utcnow_iso()}, doc_ids=[suggestion_id])
            row = table.get(doc_id=suggestion_id)
        if row is None:
            raise KeyError(f"Blackboard suggestion {suggestion_id} does not exist.")
        return self._row_to_suggestion(suggestion_id, cast(BlackboardSuggestionRecord, row))

    def _default_state(self) -> dict[str, Any]:
        return {
            "connected": False,
            "needs_login": True,
            "user": None,
            "learn_version": None,
            "last_sync_at": None,
            "last_error": None,
            "last_summary": None,
            "updated_at": self._utcnow_iso(),
        }

    def _utcnow_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _row_to_remote_item(self, item_id: int, row: BlackboardRemoteItemRecord) -> BlackboardRemoteItem:
        return BlackboardRemoteItem(
            id=item_id,
            source_key=row["source_key"],
            source_type=row["source_type"],
            source_id=row["source_id"],
            course_id=row["course_id"],
            course_name=row["course_name"],
            title=row["title"],
            body_text=row["body_text"],
            url=row["url"],
            created_at=row["created_at"],
            modified_at=row["modified_at"],
            due_at=row["due_at"],
            raw_hash=row["raw_hash"],
            raw_json=row["raw_json"],
            first_seen_at=row["first_seen_at"],
            last_seen_at=row["last_seen_at"],
            missing_count=row["missing_count"],
            deleted_at=row["deleted_at"],
        )

    def _row_to_suggestion(self, suggestion_id: int, row: BlackboardSuggestionRecord) -> BlackboardSuggestion:
        return BlackboardSuggestion(
            id=suggestion_id,
            source_key=row["source_key"],
            source_hash=row["source_hash"],
            source_type=row["source_type"],
            course_id=row["course_id"],
            course_name=row["course_name"],
            action=row["action"],
            status=row["status"],
            title=row["title"],
            detail=row["detail"],
            due_at=row["due_at"],
            start_at=row["start_at"],
            end_at=row["end_at"],
            confidence=row["confidence"],
            reason=row["reason"],
            target_id=row["target_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
