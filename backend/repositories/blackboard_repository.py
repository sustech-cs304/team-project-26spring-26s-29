"""Blackboard sync persistence contracts and records."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol, TypedDict


SuggestionAction = Literal["create_todo", "create_schedule", "ignore"]
SuggestionStatus = Literal["pending", "applied", "dismissed"]


@dataclass(frozen=True, slots=True)
class BlackboardRemoteItem:
    id: int
    source_key: str
    source_type: str
    source_id: str
    course_id: str | None
    course_name: str | None
    title: str
    body_text: str
    url: str | None
    created_at: str | None
    modified_at: str | None
    due_at: str | None
    raw_hash: str
    raw_json: dict[str, Any]
    first_seen_at: str
    last_seen_at: str
    missing_count: int
    deleted_at: str | None


@dataclass(frozen=True, slots=True)
class BlackboardSuggestion:
    id: int
    source_key: str
    source_hash: str
    source_type: str
    course_id: str | None
    course_name: str | None
    action: SuggestionAction
    status: SuggestionStatus
    title: str
    detail: str
    due_at: str | None
    start_at: str | None
    end_at: str | None
    confidence: float
    reason: str
    target_id: int | None
    created_at: str
    updated_at: str


class BlackboardRemoteItemRecord(TypedDict):
    source_key: str
    source_type: str
    source_id: str
    course_id: str | None
    course_name: str | None
    title: str
    body_text: str
    url: str | None
    created_at: str | None
    modified_at: str | None
    due_at: str | None
    raw_hash: str
    raw_json: dict[str, Any]
    first_seen_at: str
    last_seen_at: str
    missing_count: int
    deleted_at: str | None


class BlackboardSuggestionRecord(TypedDict):
    source_key: str
    source_hash: str
    source_type: str
    course_id: str | None
    course_name: str | None
    action: SuggestionAction
    status: SuggestionStatus
    title: str
    detail: str
    due_at: str | None
    start_at: str | None
    end_at: str | None
    confidence: float
    reason: str
    target_id: int | None
    created_at: str
    updated_at: str


class BlackboardRepository(Protocol):
    def initialize_database(self, db_path: str | Path | None = None) -> Path: ...

    def get_state(self, db_path: str | Path | None = None) -> dict[str, Any]: ...

    def update_state(self, updates: dict[str, Any], db_path: str | Path | None = None) -> dict[str, Any]: ...

    def upsert_remote_item(
        self,
        record: BlackboardRemoteItemRecord,
        db_path: str | Path | None = None,
    ) -> tuple[BlackboardRemoteItem, bool]: ...

    def mark_missing_items(
        self,
        seen_source_keys: set[str],
        timestamp: str,
        db_path: str | Path | None = None,
    ) -> None: ...

    def list_remote_items(self, db_path: str | Path | None = None) -> list[BlackboardRemoteItem]: ...

    def find_suggestion(
        self,
        source_key: str,
        source_hash: str,
        action: SuggestionAction,
        title: str,
        db_path: str | Path | None = None,
    ) -> BlackboardSuggestion | None: ...

    def add_suggestion(
        self,
        record: BlackboardSuggestionRecord,
        db_path: str | Path | None = None,
    ) -> BlackboardSuggestion: ...

    def list_suggestions(
        self,
        status: SuggestionStatus | None = None,
        db_path: str | Path | None = None,
    ) -> list[BlackboardSuggestion]: ...

    def update_suggestion(
        self,
        suggestion_id: int,
        updates: dict[str, Any],
        db_path: str | Path | None = None,
    ) -> BlackboardSuggestion: ...
