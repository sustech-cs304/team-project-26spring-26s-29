"""Schedule management tools for the agent."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any, Literal

from agent_framework import tool
from pydantic import Field

from ...services import schedule_service

if TYPE_CHECKING:
    from ...repositories import ScheduleEvent


ScheduleAction = Literal["list", "list_range", "create", "update", "delete"]


def manage_schedule(
    action: Annotated[
        ScheduleAction,
        Field(description="Which schedule action to run: list, list_range, create, update, or delete."),
    ],
    event_id: Annotated[
        int | None,
        Field(description="Existing schedule id. Required for update and delete."),
    ] = None,
    title: Annotated[
        str | None,
        Field(description="Event title. Required for create and optional for update."),
    ] = None,
    detail: Annotated[
        str | None,
        Field(description="Event detail or notes. Optional for create and update."),
    ] = None,
    start_at: Annotated[
        str | None,
        Field(
            description=(
                "Start time in ISO 8601 format, e.g. 2026-04-20T09:00:00+08:00. Required for create."
            )
        ),
    ] = None,
    end_at: Annotated[
        str | None,
        Field(description="End time in ISO 8601 format. Required for create."),
    ] = None,
    all_day: Annotated[bool, Field(description="Set true for all-day events.")] = False,
    recurrence: Annotated[
        str | None,
        Field(description="Optional recurrence: 'daily', 'weekly', 'monthly', or null."),
    ] = None,
    recurrence_end: Annotated[
        str | None,
        Field(description="Optional ISO 8601 end date for recurrence."),
    ] = None,
    is_done: Annotated[bool | None, Field(description="Optional: mark event as done (true/false)")] = None,
    location: Annotated[str | None, Field(description="Optional location for the event.")] = None,
    range_start: Annotated[
        str | None,
        Field(description="Start ISO datetime for range queries (used with action='list_range')."),
    ] = None,
    range_end: Annotated[
        str | None,
        Field(description="End ISO datetime for range queries (used with action='list_range')."),
    ] = None,
) -> dict[str, Any]:
    """Manage schedule events: list, list_range, create, update, delete."""
    if action == "list":
        events = [_serialize_schedule(s) for s in schedule_service.list_schedules()]
        return {"action": "list", "count": len(events), "events": events}

    if action == "list_range":
        if not range_start or not range_end:
            raise ValueError("range_start and range_end are required for list_range action.")
        events = [_serialize_schedule(s) for s in schedule_service.list_schedules_in_range(range_start, range_end)]
        return {"action": "list_range", "count": len(events), "events": events}

    if action == "create":
        if not title or not start_at or not end_at:
            raise ValueError("title, start_at, and end_at are required for create action.")

        ev = schedule_service.create_schedule(
            title=title,
            detail="" if detail is None else detail,
            start_at=start_at,
            end_at=end_at,
            all_day=all_day,
            timezone_name=None,
            location=location,
            is_done=bool(is_done) if is_done is not None else False,
            reminder_offsets=None,
            recurrence=recurrence,
            recurrence_end=recurrence_end,
        )
        return {"action": "create", "message": f"Created schedule {ev.id}.", "event": _serialize_schedule(ev)}

    if action == "update":
        if not event_id:
            raise ValueError("event_id is required for update action.")

        updates: dict[str, object] = {}
        if title is not None:
            updates["title"] = title
        if detail is not None:
            updates["detail"] = detail
        if start_at is not None:
            updates["start_at"] = start_at
        if end_at is not None:
            updates["end_at"] = end_at
        if all_day is not None:
            updates["all_day"] = all_day
        if recurrence is not None:
            updates["recurrence"] = recurrence
        if recurrence_end is not None:
            updates["recurrence_end"] = recurrence_end
        if location is not None:
            updates["location"] = location
        if is_done is not None:
            updates["is_done"] = bool(is_done)

        ev = schedule_service.update_schedule(event_id, **updates)
        return {"action": "update", "message": f"Updated schedule {ev.id}.", "event": _serialize_schedule(ev)}

    if action == "delete":
        if not event_id:
            raise ValueError("event_id is required for delete action.")

        deleted = schedule_service.delete_schedule(event_id)
        return {"action": "delete", "message": f"Deleted schedule {event_id}.", "deleted": deleted, "event_id": event_id}

    return {"action": action, "message": f"Unsupported schedule action: {action}.", "deleted": False}


schedule_tool = tool(
    name="manage_schedule",
    description=(
        "Read, create, update, and delete schedule events. Use action='list' to inspect events, "
        "action='list_range' with range_start and range_end to fetch events in a time window, "
        "action='create' to add an event, action='update' to change an event, action='delete' to remove an event."
    ),
    approval_mode="never_require",
)(manage_schedule)

SCHEDULE_TOOLS = [schedule_tool]


def _serialize_schedule(ev: "ScheduleEvent") -> dict[str, object]:
    return {
        "id": ev.id,
        "title": ev.title,
        "detail": ev.detail,
        "start_at": ev.start_at,
        "end_at": ev.end_at,
        "all_day": ev.all_day,
        "timezone": ev.timezone,
        "location": ev.location,
        "is_cancelled": ev.is_cancelled,
        "is_done": ev.is_done,
        "completed_at": ev.completed_at,
        "reminder_offsets": ev.reminder_offsets,
        "recurrence": ev.recurrence,
        "recurrence_end": ev.recurrence_end,
        "created_at": ev.created_at,
        "updated_at": ev.updated_at,
    }
