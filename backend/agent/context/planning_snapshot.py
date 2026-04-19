"""Planning snapshot context provider for startup MOTD and quick status replies."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from agent_framework import AgentSession, ContextProvider, SessionContext

from ...repositories import ScheduleEvent, Todo
from ...services import schedule_service, todo_service


class PlanningSnapshotProvider(ContextProvider):
    """Inject schedule and todo summaries into each agent run."""

    def __init__(self, source_id: str = "planning_snapshot") -> None:
        super().__init__(source_id)

    async def before_run(
        self,
        *,
        agent: Any,
        session: AgentSession,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        snapshot = _build_planning_snapshot()
        state["planning_snapshot"] = snapshot
        session.state["planning_snapshot"] = snapshot
        context.metadata["planning_snapshot"] = snapshot
        context.extend_instructions(self.source_id, _format_planning_snapshot(snapshot))


def _now_local() -> datetime:
    return datetime.now().astimezone()


def _build_planning_snapshot() -> dict[str, Any]:
    local_now = _now_local()
    now_utc = local_now.astimezone(timezone.utc)
    schedules = schedule_service.list_schedules()
    todos = todo_service.list_todos()

    nearest_schedule = _select_nearest_schedule(schedules, now_utc)
    nearest_todo = _select_nearest_todo(todos, now_utc)

    return {
        "generated_at": local_now.isoformat(),
        "timezone": str(local_now.tzinfo),
        "schedule_total": len(schedules),
        "todo_total": len(todos),
        "nearest_schedule": (
            _serialize_schedule_summary(nearest_schedule, now_utc, local_now.tzinfo)
            if nearest_schedule is not None
            else None
        ),
        "nearest_todo": (
            _serialize_todo_summary(nearest_todo, now_utc, local_now.tzinfo)
            if nearest_todo is not None
            else None
        ),
    }


def _select_nearest_schedule(
    schedules: list[ScheduleEvent],
    now_utc: datetime,
) -> ScheduleEvent | None:
    if not schedules:
        return None

    now_ms = int(now_utc.timestamp() * 1000)
    active_or_upcoming = [
        event for event in schedules if not event.is_cancelled and event.end_ts >= now_ms
    ]
    if active_or_upcoming:
        return min(
            active_or_upcoming,
            key=lambda event: (
                0 if event.start_ts <= now_ms < event.end_ts else 1,
                event.start_ts,
                event.id,
            ),
        )

    historical = [event for event in schedules if not event.is_cancelled]
    if not historical:
        return None

    return max(historical, key=lambda event: (event.end_ts, event.id))


def _select_nearest_todo(todos: list[Todo], now_utc: datetime) -> Todo | None:
    if not todos:
        return None

    pending = [todo for todo in todos if not todo.is_done]
    pending_with_due = [
        (todo, due_dt)
        for todo in pending
        if (due_dt := _parse_iso_datetime(todo.due_at)) is not None
    ]
    if pending_with_due:
        nearest_todo, _due_dt = min(
            pending_with_due,
            key=lambda pair: (
                abs((pair[1] - now_utc).total_seconds()),
                pair[1].timestamp(),
                pair[0].id,
            ),
        )
        return nearest_todo

    if pending:
        return max(
            pending,
            key=lambda todo: (_timestamp_or_min(todo.updated_at), todo.id),
        )

    return max(
        todos,
        key=lambda todo: (_timestamp_or_min(todo.updated_at), todo.id),
    )


def _serialize_schedule_summary(
    event: ScheduleEvent,
    now_utc: datetime,
    display_tz: timezone | Any,
) -> dict[str, Any]:
    now_ms = int(now_utc.timestamp() * 1000)
    if event.start_ts <= now_ms < event.end_ts:
        timing = "ongoing"
    elif event.start_ts >= now_ms:
        timing = "upcoming"
    else:
        timing = "most_recent_past"

    return {
        "id": event.id,
        "title": event.title,
        "detail": _truncate_text(event.detail),
        "location": event.location,
        "start_at": event.start_at,
        "end_at": event.end_at,
        "start_local": _format_local_datetime(event.start_at, display_tz),
        "end_local": _format_local_datetime(event.end_at, display_tz),
        "timing": timing,
        "is_done": event.is_done,
        "is_cancelled": event.is_cancelled,
    }


def _serialize_todo_summary(
    todo: Todo,
    now_utc: datetime,
    display_tz: timezone | Any,
) -> dict[str, Any]:
    due_dt = _parse_iso_datetime(todo.due_at)
    if todo.is_done:
        urgency = "done"
    elif due_dt is None:
        urgency = "pending_without_due"
    elif due_dt < now_utc:
        urgency = "overdue"
    else:
        urgency = "upcoming"

    return {
        "id": todo.id,
        "title": todo.title,
        "detail": _truncate_text(todo.detail),
        "due_at": todo.due_at,
        "due_local": _format_local_datetime(todo.due_at, display_tz),
        "updated_at": todo.updated_at,
        "updated_local": _format_local_datetime(todo.updated_at, display_tz),
        "urgency": urgency,
        "is_done": todo.is_done,
    }


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _format_local_datetime(value: str | None, display_tz: timezone | Any) -> str | None:
    parsed = _parse_iso_datetime(value)
    if parsed is None:
        return None
    return parsed.astimezone(display_tz).strftime("%Y-%m-%d %H:%M %Z")


def _timestamp_or_min(value: str | None) -> float:
    parsed = _parse_iso_datetime(value)
    if parsed is None:
        return float("-inf")
    return parsed.timestamp()


def _truncate_text(value: str | None, max_length: int = 120) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 3].rstrip()}..."


def _format_planning_snapshot(snapshot: dict[str, Any]) -> str:
    payload = {
        "timezone": snapshot["timezone"],
        "schedule_total": snapshot["schedule_total"],
        "nearest_schedule": snapshot["nearest_schedule"],
        "todo_total": snapshot["todo_total"],
        "nearest_todo": snapshot["nearest_todo"],
        "selection_rules": {
            "nearest_schedule": (
                "Prefer an ongoing schedule event first, otherwise the upcoming non-cancelled event "
                "with the earliest start time, otherwise the most recent past non-cancelled event."
            ),
            "nearest_todo": (
                "Prefer the pending todo whose due time is closest to now, otherwise the most recently "
                "updated pending todo, otherwise the most recently updated todo."
            ),
        },
    }
    return "Planning snapshot for schedule/todo-aware replies:\n" + json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    )
