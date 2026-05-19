"""Schedule management tools for the agent."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any

from agent_framework import tool
from pydantic import Field

from ...services import schedule_service

if TYPE_CHECKING:
    from ...repositories import ScheduleEvent


SCHEDULE_TOOL_SCOPE = (
    "Use this tool for real-world events the user must attend on time, such as classes, meetings, exams, "
    "appointments, interviews, departures, and travel. If the user asks to remember or remind them about a timed "
    "event they must attend, store it here. For example, 'remind me tomorrow about my exam' belongs in schedule. "
    "Do not use this tool for homework, assignments, projects, or other tasks that only need to be completed before "
    "a deadline; those belong in todo. Never use this tool for the assistant's own short-term work or internal plan."
)


def list_schedules(
    include_cancelled: Annotated[
        bool,
        Field(description="Set true to include cancelled events in the result."),
    ] = True,
) -> dict[str, Any]:
    """Read the user's fixed-time schedule events and return ids plus current fields."""
    events = [
        _serialize_schedule(event)
        for event in schedule_service.list_schedules(include_cancelled=include_cancelled)
    ]
    return {
        "action": "list",
        "count": len(events),
        "events": events,
    }


def list_schedules_in_range(
    range_start: Annotated[
        str,
        Field(description="Start ISO datetime for the requested time window."),
    ],
    range_end: Annotated[
        str,
        Field(description="End ISO datetime for the requested time window."),
    ],
    include_cancelled: Annotated[
        bool,
        Field(description="Set true to include cancelled events in the result."),
    ] = True,
) -> dict[str, Any]:
    """Read schedule events in a time window and return ids plus current fields."""
    events = [
        _serialize_schedule(event)
        for event in schedule_service.list_schedules_in_range(
            range_start,
            range_end,
            include_cancelled=include_cancelled,
        )
    ]
    return {
        "action": "list_range",
        "count": len(events),
        "events": events,
    }


def create_schedule(
    title: Annotated[
        str,
        Field(description="Event title."),
    ],
    start_at: Annotated[
        str,
        Field(description="Start time in ISO 8601 format, e.g. 2026-04-20T09:00:00+08:00."),
    ],
    end_at: Annotated[
        str,
        Field(description="End time in ISO 8601 format."),
    ],
    detail: Annotated[
        str | None,
        Field(description="Event detail or notes."),
    ] = None,
    all_day: Annotated[
        bool,
        Field(description="Set true for all-day events."),
    ] = False,
    recurrence: Annotated[
        str | None,
        Field(description="Optional recurrence: 'daily', 'weekly', 'monthly', or null."),
    ] = None,
    recurrence_end: Annotated[
        str | None,
        Field(description="Optional ISO 8601 end date for recurrence."),
    ] = None,
    is_done: Annotated[
        bool | None,
        Field(description="Optional: mark event as done (true/false)."),
    ] = None,
    location: Annotated[
        str | None,
        Field(description="Optional location for the event."),
    ] = None,
) -> dict[str, Any]:
    """Create a new fixed-time schedule event for the user's attendance-based commitments."""
    event = schedule_service.create_schedule(
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
    return {
        "action": "create",
        "message": f"Created schedule {event.id}.",
        "event": _serialize_schedule(event),
    }


def update_schedule(
    event_id: Annotated[
        int,
        Field(description="Existing schedule id to update."),
    ],
    title: Annotated[
        str | None,
        Field(description="Event title."),
    ] = None,
    detail: Annotated[
        str | None,
        Field(description="Event detail or notes."),
    ] = None,
    start_at: Annotated[
        str | None,
        Field(description="Optional start time in ISO 8601 format."),
    ] = None,
    end_at: Annotated[
        str | None,
        Field(description="Optional end time in ISO 8601 format."),
    ] = None,
    all_day: Annotated[
        bool | None,
        Field(description="Set true for all-day events or false for timed events."),
    ] = None,
    recurrence: Annotated[
        str | None,
        Field(description="Optional recurrence: 'daily', 'weekly', 'monthly', or null."),
    ] = None,
    recurrence_end: Annotated[
        str | None,
        Field(description="Optional ISO 8601 end date for recurrence."),
    ] = None,
    is_done: Annotated[
        bool | None,
        Field(description="Set true to complete the event or false to reopen it."),
    ] = None,
    location: Annotated[
        str | None,
        Field(description="Optional location for the event."),
    ] = None,
    clear_location: Annotated[
        bool,
        Field(description="Set true to remove the current event location."),
    ] = False,
) -> dict[str, Any]:
    """Update an existing fixed-time schedule event for the user's attendance-based commitments."""
    updates = _build_schedule_updates(
        title=title,
        detail=detail,
        start_at=start_at,
        end_at=end_at,
        all_day=all_day,
        recurrence=recurrence,
        recurrence_end=recurrence_end,
        is_done=is_done,
        location=location,
        clear_location=clear_location,
    )
    event = schedule_service.update_schedule(event_id, **updates)
    return {
        "action": "update",
        "message": f"Updated schedule {event.id}.",
        "event": _serialize_schedule(event),
    }


def delete_schedule(
    event_id: Annotated[
        int,
        Field(description="Existing schedule id to delete."),
    ],
) -> dict[str, Any]:
    """Delete a fixed-time schedule event from the user's attendance-based commitments."""
    deleted = schedule_service.delete_schedule(event_id)
    return {
        "action": "delete",
        "message": f"Deleted schedule {event_id}.",
        "deleted": deleted,
        "event_id": event_id,
    }


list_schedules_tool = tool(
    name="list_schedules",
    description=(
        "Read the user's fixed-time schedule events and return existing events with their ids. "
        f"{SCHEDULE_TOOL_SCOPE}"
    ),
    approval_mode="never_require",
)(list_schedules)

list_schedules_in_range_tool = tool(
    name="list_schedules_in_range",
    description=(
        "Read schedule events in a time window and return matching events with their ids. "
        f"{SCHEDULE_TOOL_SCOPE}"
    ),
    approval_mode="never_require",
)(list_schedules_in_range)

create_schedule_tool = tool(
    name="create_schedule",
    description=(
        "Create a new fixed-time schedule event in the user's personal local schedule. "
        f"{SCHEDULE_TOOL_SCOPE}"
    ),
    approval_mode="always_require",
)(create_schedule)

update_schedule_tool = tool(
    name="update_schedule",
    description=(
        "Update an existing fixed-time schedule event by id in the user's personal local schedule. "
        f"{SCHEDULE_TOOL_SCOPE}"
    ),
    approval_mode="always_require",
)(update_schedule)

delete_schedule_tool = tool(
    name="delete_schedule",
    description=(
        "Delete an existing fixed-time schedule event by id from the user's personal local schedule. "
        f"{SCHEDULE_TOOL_SCOPE}"
    ),
    approval_mode="always_require",
)(delete_schedule)

SCHEDULE_TOOLS = [
    list_schedules_tool,
    list_schedules_in_range_tool,
    create_schedule_tool,
    update_schedule_tool,
    delete_schedule_tool,
]


def _build_schedule_updates(
    *,
    title: str | None,
    detail: str | None,
    start_at: str | None,
    end_at: str | None,
    all_day: bool | None,
    recurrence: str | None,
    recurrence_end: str | None,
    is_done: bool | None,
    location: str | None,
    clear_location: bool,
) -> dict[str, object]:
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
    if clear_location:
        updates["location"] = None
    elif location is not None:
        updates["location"] = location
    if is_done is not None:
        updates["is_done"] = is_done
    return updates


def _serialize_schedule(event: ScheduleEvent) -> dict[str, object]:
    return {
        "id": event.id,
        "title": event.title,
        "detail": event.detail,
        "start_at": event.start_at,
        "end_at": event.end_at,
        "all_day": event.all_day,
        "timezone": event.timezone,
        "location": event.location,
        "is_cancelled": event.is_cancelled,
        "is_done": event.is_done,
        "completed_at": event.completed_at,
        "reminder_offsets": event.reminder_offsets,
        "recurrence": event.recurrence,
        "recurrence_end": event.recurrence_end,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
    }
