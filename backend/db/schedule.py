"""Compatibility wrappers for schedule storage helpers."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ..repositories import ScheduleEvent, schedule_repository
from ..repositories.schedule_repository import UNSET


def initialize_schedule_database(db_path: str | Path | None = None) -> Path:
    return schedule_repository.initialize_database(db_path)


def add_schedule_event(
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
    recurrence: str | None = None,
    recurrence_end: str | None = None,
    db_path: str | Path | None = None,
) -> ScheduleEvent:
    return schedule_repository.add_schedule_event(
        title,
        detail,
        start_at,
        end_at,
        all_day=all_day,
        timezone_name=timezone_name,
        location=location,
        is_cancelled=is_cancelled,
        reminder_offsets=reminder_offsets,
        recurrence=recurrence,
        recurrence_end=recurrence_end,
        db_path=db_path,
    )


def get_schedule_event(event_id: int, db_path: str | Path | None = None) -> ScheduleEvent | None:
    return schedule_repository.get_schedule_event(event_id, db_path)


def list_schedule_events(
    db_path: str | Path | None = None,
    *,
    include_cancelled: bool = True,
) -> list[ScheduleEvent]:
    return schedule_repository.list_schedule_events(db_path, include_cancelled=include_cancelled)


def list_schedule_events_in_range(
    range_start: str | datetime,
    range_end: str | datetime,
    db_path: str | Path | None = None,
    *,
    include_cancelled: bool = True,
) -> list[ScheduleEvent]:
    return schedule_repository.list_schedule_events_in_range(
        range_start,
        range_end,
        db_path,
        include_cancelled=include_cancelled,
    )


def update_schedule_event(
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
    recurrence: str | None | object = UNSET,
    recurrence_end: str | None | object = UNSET,
    db_path: str | Path | None = None,
) -> ScheduleEvent:
    return schedule_repository.update_schedule_event(
        event_id,
        title=title,
        detail=detail,
        start_at=start_at,
        end_at=end_at,
        all_day=all_day,
        timezone_name=timezone_name,
        location=location,
        is_cancelled=is_cancelled,
        reminder_offsets=reminder_offsets,
        recurrence=recurrence,
        recurrence_end=recurrence_end,
        db_path=db_path,
    )


def delete_schedule_event(event_id: int, db_path: str | Path | None = None) -> bool:
    return schedule_repository.delete_schedule_event(event_id, db_path)


def delete_all_schedule_events(db_path: str | Path | None = None) -> int:
    return schedule_repository.delete_all_schedule_events(db_path)
