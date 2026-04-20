"""TinyDB-backed schedule repository."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import cast

from ..schedule_repository import UNSET, ScheduleEvent
from .storage import get_database_path, open_table


_TABLE_NAME = "schedule_events"
_DEFAULT_TIMEZONE = "UTC"


class TinyDbScheduleRepository:
    def initialize_database(self, db_path: str | Path | None = None) -> Path:
        database_path = get_database_path(db_path)
        with open_table(_TABLE_NAME, database_path):
            pass
        return database_path

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
        is_done: bool = False,
        completed_at: str | None = None,
        is_cancelled: bool = False,
        reminder_offsets: list[int] | tuple[int, ...] | None = None,
        recurrence: str | None = None,
        recurrence_end: str | None = None,
        db_path: str | Path | None = None,
    ) -> ScheduleEvent:
        start_dt = self._parse_datetime(start_at)
        end_dt = self._parse_datetime(end_at)

        payload: dict[str, object] = {
            "title": title,
            "detail": detail,
            "all_day": all_day,
            "timezone": timezone_name or _DEFAULT_TIMEZONE,
            "location": location,
            "is_cancelled": is_cancelled,
            "reminder_offsets": [] if reminder_offsets is None else list(reminder_offsets),
            "recurrence": recurrence,
            "recurrence_end": recurrence_end,
        }
        payload.update(self._build_time_cache(start_dt, end_dt))

        timestamp = self._utcnow_iso()
        payload["created_at"] = timestamp
        payload["updated_at"] = timestamp
        payload["is_done"] = is_done
        payload["completed_at"] = completed_at

        with open_table(_TABLE_NAME, db_path) as table:
            event_id = int(table.insert(payload))
            row = cast(dict[str, object], table.get(doc_id=event_id))

        return self._row_to_schedule_event(event_id, row)

    def get_schedule_event(
        self,
        event_id: int,
        db_path: str | Path | None = None,
    ) -> ScheduleEvent | None:
        with open_table(_TABLE_NAME, db_path) as table:
            row = table.get(doc_id=event_id)

        if row is None:
            return None

        return self._row_to_schedule_event(event_id, cast(dict[str, object], row))

    def list_schedule_events(
        self,
        db_path: str | Path | None = None,
        *,
        include_cancelled: bool = True,
    ) -> list[ScheduleEvent]:
        with open_table(_TABLE_NAME, db_path) as table:
            documents = table.all()

        events = [self._row_to_schedule_event(int(document.doc_id), cast(dict[str, object], document)) for document in documents]
        if not include_cancelled:
            events = [event for event in events if not event.is_cancelled]

        return sorted(events, key=lambda event: (event.start_ts, event.id))

    def list_schedule_events_in_range(
        self,
        range_start: str | datetime,
        range_end: str | datetime,
        db_path: str | Path | None = None,
        *,
        include_cancelled: bool = True,
    ) -> list[ScheduleEvent]:
        start_dt = self._parse_datetime(range_start)
        end_dt = self._parse_datetime(range_end)

        start_ts = int(start_dt.timestamp() * 1000)
        end_ts = int(end_dt.timestamp() * 1000)

        events = self.list_schedule_events(db_path, include_cancelled=include_cancelled)
        return [event for event in events if event.end_ts > start_ts and event.start_ts < end_ts]

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
        is_done: bool | None = None,
        is_cancelled: bool | None = None,
        reminder_offsets: list[int] | tuple[int, ...] | None | object = UNSET,
        recurrence: str | None | object = UNSET,
        recurrence_end: str | None | object = UNSET,
        db_path: str | Path | None = None,
    ) -> ScheduleEvent:
        updates: dict[str, object] = {}

        if title is not None:
            updates["title"] = title

        if detail is not None:
            updates["detail"] = detail

        if all_day is not None:
            updates["all_day"] = all_day

        if timezone_name is not None:
            updates["timezone"] = timezone_name

        if location is not UNSET:
            updates["location"] = cast(str | None, location)

        if is_cancelled is not None:
            updates["is_cancelled"] = is_cancelled

        # Handle is_done/completed_at transitions
        if is_done is not None:
            # If marking done, set completed_at if not already present
            updates["is_done"] = is_done
            if is_done:
                updates["completed_at"] = self._utcnow_iso()
            else:
                updates["completed_at"] = None

        if reminder_offsets is not UNSET:
            updates["reminder_offsets"] = [] if reminder_offsets is None else list(cast(list[int] | tuple[int, ...], reminder_offsets))

        if recurrence is not UNSET:
            updates["recurrence"] = cast(str | None, recurrence)

        if recurrence_end is not UNSET:
            updates["recurrence_end"] = cast(str | None, recurrence_end)

        with open_table(_TABLE_NAME, db_path) as table:
            existing = cast(dict[str, object], table.get(doc_id=event_id))

            existing_start = self._parse_datetime(cast(str | datetime, existing["start_at"]))
            existing_end = self._parse_datetime(cast(str | datetime, existing["end_at"]))

            next_start = existing_start
            next_end = existing_end

            if start_at is not UNSET:
                next_start = self._parse_datetime(cast(str | datetime, start_at))
            if end_at is not UNSET:
                next_end = self._parse_datetime(cast(str | datetime, end_at))

            if start_at is not UNSET or end_at is not UNSET:
                updates.update(self._build_time_cache(next_start, next_end))

            updates["updated_at"] = self._utcnow_iso()

            table.update(updates, doc_ids=[event_id])
            row = cast(dict[str, object], table.get(doc_id=event_id))

        return self._row_to_schedule_event(event_id, row)

    def delete_schedule_event(self, event_id: int, db_path: str | Path | None = None) -> bool:
        with open_table(_TABLE_NAME, db_path) as table:
            removed_ids = table.remove(doc_ids=[event_id])

        return len(removed_ids) > 0

    def delete_all_schedule_events(self, db_path: str | Path | None = None) -> int:
        with open_table(_TABLE_NAME, db_path) as table:
            removed_count = len(table)
            table.truncate()

        return removed_count

    def _utcnow_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _parse_datetime(self, value: str | datetime) -> datetime:
        if isinstance(value, datetime):
            parsed = value
        else:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)

        return parsed.astimezone(timezone.utc)

    def _build_time_cache(self, start_dt: datetime, end_dt: datetime) -> dict[str, str | int]:
        return {
            "start_at": start_dt.isoformat(),
            "end_at": end_dt.isoformat(),
            "start_day": start_dt.date().isoformat(),
            "end_day": end_dt.date().isoformat(),
            "start_ts": int(start_dt.timestamp() * 1000),
            "end_ts": int(end_dt.timestamp() * 1000),
        }

    def _row_to_schedule_event(self, event_id: int, row: dict[str, object]) -> ScheduleEvent:
        start_dt = self._parse_datetime(cast(str | datetime, row["start_at"]))
        end_dt = self._parse_datetime(cast(str | datetime, row["end_at"]))
        reminder_offsets_raw = cast(list[int] | tuple[int, ...], row["reminder_offsets"])
        recurrence_raw = row.get("recurrence")
        recurrence_end_raw = row.get("recurrence_end")

        return ScheduleEvent(
            id=event_id,
            title=cast(str, row["title"]),
            detail=cast(str, row["detail"]),
            start_at=start_dt.isoformat(),
            end_at=end_dt.isoformat(),
            all_day=cast(bool, row["all_day"]),
            timezone=cast(str, row["timezone"]),
            location=cast(str | None, row["location"]),
            is_cancelled=cast(bool, row["is_cancelled"]),
            is_done=cast(bool, row.get("is_done", False)),
            completed_at=cast(str | None, row.get("completed_at")),
            reminder_offsets=list(reminder_offsets_raw),
            recurrence=cast(str | None, recurrence_raw),
            recurrence_end=cast(str | None, recurrence_end_raw),
            created_at=cast(str, row["created_at"]),
            updated_at=cast(str, row["updated_at"]),
            start_day=cast(str, row["start_day"]),
            end_day=cast(str, row["end_day"]),
            start_ts=cast(int, row["start_ts"]),
            end_ts=cast(int, row["end_ts"]),
        )
