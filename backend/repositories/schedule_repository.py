"""Schedule repository contracts and entities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol


UNSET = object()


@dataclass(frozen=True, slots=True)
class ScheduleEvent:
    id: int
    title: str
    detail: str
    start_at: str
    end_at: str
    all_day: bool
    timezone: str
    location: str | None
    is_cancelled: bool
    reminder_offsets: list[int]
    created_at: str
    updated_at: str
    start_day: str
    end_day: str
    start_ts: int
    end_ts: int


class ScheduleRepository(Protocol):
    def initialize_database(self, db_path: str | Path | None = None) -> Path: ...

    def add_schedule_event(
        self,
        title: str,
        detail: str,
        start_at: str | datetime,
        end_at: str | datetime,
        *,
        all_day: bool = False,
        timezone_name: str | None = None,
        location: str | None = None,
        is_cancelled: bool = False,
        reminder_offsets: list[int] | tuple[int, ...] | None = None,
        db_path: str | Path | None = None,
    ) -> ScheduleEvent: ...

    def get_schedule_event(
        self,
        event_id: int,
        db_path: str | Path | None = None,
    ) -> ScheduleEvent | None: ...

    def list_schedule_events(
        self,
        db_path: str | Path | None = None,
        *,
        include_cancelled: bool = True,
    ) -> list[ScheduleEvent]: ...

    def list_schedule_events_in_range(
        self,
        range_start: str | datetime,
        range_end: str | datetime,
        db_path: str | Path | None = None,
        *,
        include_cancelled: bool = True,
    ) -> list[ScheduleEvent]: ...

    def update_schedule_event(
        self,
        event_id: int,
        *,
        title: str | None = None,
        detail: str | None = None,
        start_at: str | datetime | object = UNSET,
        end_at: str | datetime | object = UNSET,
        all_day: bool | None = None,
        timezone_name: str | None = None,
        location: str | None | object = UNSET,
        is_cancelled: bool | None = None,
        reminder_offsets: list[int] | tuple[int, ...] | None | object = UNSET,
        db_path: str | Path | None = None,
    ) -> ScheduleEvent: ...

    def delete_schedule_event(self, event_id: int, db_path: str | Path | None = None) -> bool: ...

    def delete_all_schedule_events(self, db_path: str | Path | None = None) -> int: ...
