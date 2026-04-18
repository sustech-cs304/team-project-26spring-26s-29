"""TinyDB-backed schedule event storage."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from tinydb import TinyDB
from tinydb.table import Table

from .todo import get_database_path


_TABLE_NAME = "schedule_events"
_DEFAULT_TIMEZONE = "UTC"
_UNSET = object()


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


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    return text


def _normalize_timezone(value: str | None) -> str:
    if value is None:
        return _DEFAULT_TIMEZONE

    timezone_name = str(value).strip()
    if not timezone_name:
        return _DEFAULT_TIMEZONE

    return timezone_name


def _parse_datetime(value: str | datetime, field_name: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            raise ValueError(f"{field_name} is required.")

        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"{field_name} must be an ISO datetime string.") from exc

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def _normalize_reminder_offsets(value: list[int] | tuple[int, ...] | None) -> list[int]:
    if value is None:
        return []

    normalized: list[int] = []
    for item in value:
        try:
            offset = int(item)
        except (TypeError, ValueError) as exc:
            raise ValueError("reminder_offsets must contain integers.") from exc

        if offset < 0:
            raise ValueError("reminder_offsets values must be non-negative.")

        normalized.append(offset)

    return sorted(set(normalized))


def _build_time_cache(start_dt: datetime, end_dt: datetime) -> dict[str, str | int]:
    return {
        "start_at": start_dt.isoformat(),
        "end_at": end_dt.isoformat(),
        "start_day": start_dt.date().isoformat(),
        "end_day": end_dt.date().isoformat(),
        "start_ts": int(start_dt.timestamp() * 1000),
        "end_ts": int(end_dt.timestamp() * 1000),
    }


def _validate_time_window(start_dt: datetime, end_dt: datetime) -> None:
    if end_dt <= start_dt:
        raise ValueError("end_at must be after start_at.")


def initialize_schedule_database(db_path: str | Path | None = None) -> Path:
    database_path = get_database_path(db_path)
    with _table(database_path):
        pass
    return database_path


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
    db_path: str | Path | None = None,
) -> ScheduleEvent:
    title_value = str(title).strip()
    if not title_value:
        raise ValueError("title is required.")

    detail_value = str(detail)
    start_dt = _parse_datetime(start_at, "start_at")
    end_dt = _parse_datetime(end_at, "end_at")
    _validate_time_window(start_dt, end_dt)

    payload: dict[str, object] = {
        "title": title_value,
        "detail": detail_value,
        "all_day": bool(all_day),
        "timezone": _normalize_timezone(timezone_name),
        "location": _normalize_optional_text(location),
        "is_cancelled": bool(is_cancelled),
        "reminder_offsets": _normalize_reminder_offsets(reminder_offsets),
    }
    payload.update(_build_time_cache(start_dt, end_dt))

    timestamp = _utcnow_iso()
    payload["created_at"] = timestamp
    payload["updated_at"] = timestamp

    with _table(get_database_path(db_path)) as table:
        event_id = int(table.insert(payload))
        row = table.get(doc_id=event_id)

    return _row_to_schedule_event(event_id, row)


def get_schedule_event(event_id: int, db_path: str | Path | None = None) -> ScheduleEvent | None:
    with _table(get_database_path(db_path)) as table:
        row = table.get(doc_id=event_id)

    if row is None:
        return None

    return _row_to_schedule_event(event_id, row)


def list_schedule_events(
    db_path: str | Path | None = None,
    *,
    include_cancelled: bool = True,
) -> list[ScheduleEvent]:
    with _table(get_database_path(db_path)) as table:
        documents = table.all()

    events = [_row_to_schedule_event(int(document.doc_id), document) for document in documents]
    if not include_cancelled:
        events = [event for event in events if not event.is_cancelled]

    return sorted(events, key=lambda event: (event.start_ts, event.id))


def list_schedule_events_in_range(
    range_start: str | datetime,
    range_end: str | datetime,
    db_path: str | Path | None = None,
    *,
    include_cancelled: bool = True,
) -> list[ScheduleEvent]:
    start_dt = _parse_datetime(range_start, "range_start")
    end_dt = _parse_datetime(range_end, "range_end")
    _validate_time_window(start_dt, end_dt)

    start_ts = int(start_dt.timestamp() * 1000)
    end_ts = int(end_dt.timestamp() * 1000)

    events = list_schedule_events(db_path, include_cancelled=include_cancelled)
    return [event for event in events if event.end_ts > start_ts and event.start_ts < end_ts]


def update_schedule_event(
    event_id: int,
    *,
    title: str | None = None,
    detail: str | None = None,
    start_at: str | datetime | object = _UNSET,
    end_at: str | datetime | object = _UNSET,
    all_day: bool | None = None,
    timezone_name: str | None = None,
    location: str | None | object = _UNSET,
    is_cancelled: bool | None = None,
    reminder_offsets: list[int] | tuple[int, ...] | None | object = _UNSET,
    db_path: str | Path | None = None,
) -> ScheduleEvent:
    updates: dict[str, object] = {}

    if title is not None:
        title_value = str(title).strip()
        if not title_value:
            raise ValueError("title is required.")
        updates["title"] = title_value

    if detail is not None:
        updates["detail"] = str(detail)

    if all_day is not None:
        updates["all_day"] = bool(all_day)

    if timezone_name is not None:
        updates["timezone"] = _normalize_timezone(timezone_name)

    if location is not _UNSET:
        updates["location"] = _normalize_optional_text(location)

    if is_cancelled is not None:
        updates["is_cancelled"] = bool(is_cancelled)

    if reminder_offsets is not _UNSET:
        updates["reminder_offsets"] = _normalize_reminder_offsets(reminder_offsets)

    with _table(get_database_path(db_path)) as table:
        existing = table.get(doc_id=event_id)
        if existing is None:
            raise KeyError(f"Schedule event {event_id} does not exist.")

        existing_start = _parse_datetime(str(existing.get("start_at", "")), "start_at")
        existing_end = _parse_datetime(str(existing.get("end_at", "")), "end_at")

        next_start = existing_start
        next_end = existing_end

        if start_at is not _UNSET:
            next_start = _parse_datetime(start_at, "start_at")
        if end_at is not _UNSET:
            next_end = _parse_datetime(end_at, "end_at")

        if start_at is not _UNSET or end_at is not _UNSET:
            _validate_time_window(next_start, next_end)
            updates.update(_build_time_cache(next_start, next_end))

        if not updates:
            raise ValueError("At least one schedule field must be provided for update.")

        if "created_at" not in existing:
            updates["created_at"] = _utcnow_iso()
        updates["updated_at"] = _utcnow_iso()

        table.update(updates, doc_ids=[event_id])
        row = table.get(doc_id=event_id)

    return _row_to_schedule_event(event_id, row)


def delete_schedule_event(event_id: int, db_path: str | Path | None = None) -> bool:
    with _table(get_database_path(db_path)) as table:
        removed_ids = table.remove(doc_ids=[event_id])

    return len(removed_ids) > 0


def delete_all_schedule_events(db_path: str | Path | None = None) -> int:
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


def _row_to_schedule_event(event_id: int, row: dict[str, object] | None) -> ScheduleEvent:
    if row is None:
        raise RuntimeError("Schedule query did not return a row.")

    start_dt = _parse_datetime(str(row.get("start_at", "")), "start_at")
    end_dt = _parse_datetime(str(row.get("end_at", "")), "end_at")

    start_ts_raw = row.get("start_ts")
    end_ts_raw = row.get("end_ts")

    try:
        start_ts = int(start_ts_raw) if start_ts_raw is not None else int(start_dt.timestamp() * 1000)
    except (TypeError, ValueError):
        start_ts = int(start_dt.timestamp() * 1000)

    try:
        end_ts = int(end_ts_raw) if end_ts_raw is not None else int(end_dt.timestamp() * 1000)
    except (TypeError, ValueError):
        end_ts = int(end_dt.timestamp() * 1000)

    reminder_offsets_raw = row.get("reminder_offsets")
    reminder_offsets = _normalize_reminder_offsets(
        reminder_offsets_raw if isinstance(reminder_offsets_raw, (list, tuple)) else None,
    )

    return ScheduleEvent(
        id=event_id,
        title=str(row["title"]),
        detail=str(row["detail"]),
        start_at=start_dt.isoformat(),
        end_at=end_dt.isoformat(),
        all_day=bool(row.get("all_day", False)),
        timezone=_normalize_timezone(_normalize_optional_text(row.get("timezone"))),
        location=_normalize_optional_text(row.get("location")),
        is_cancelled=bool(row.get("is_cancelled", False)),
        reminder_offsets=reminder_offsets,
        created_at=str(row.get("created_at", "")),
        updated_at=str(row.get("updated_at", "")),
        start_day=str(row.get("start_day", start_dt.date().isoformat())),
        end_day=str(row.get("end_day", end_dt.date().isoformat())),
        start_ts=start_ts,
        end_ts=end_ts,
    )
