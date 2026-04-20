"""Best-effort todo-to-schedule binding helpers."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from ..repositories import ScheduleEvent, Todo, schedule_repository
from ..repositories.binding_repository import TodoScheduleBinding, binding_repository


logger = logging.getLogger(__name__)
DEFAULT_SCHEDULE_DURATION_MINUTES = 30


@dataclass(frozen=True, slots=True)
class TodoScheduleBindingResult:
    todo: Todo
    created_schedule: ScheduleEvent | None
    binding: TodoScheduleBinding | None
    binding_error: str | None


def bind_after_todo_created(
    todo: Todo,
    *,
    schedule_duration_minutes: int = DEFAULT_SCHEDULE_DURATION_MINUTES,
) -> TodoScheduleBindingResult:
    if todo.due_at is None:
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=None,
            binding=None,
            binding_error=None,
        )

    existing_binding = binding_repository.get_binding_by_todo_id(todo.id)
    if existing_binding is not None:
        linked_schedule = schedule_repository.get_schedule_event(existing_binding.schedule_event_id)
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=linked_schedule,
            binding=existing_binding,
            binding_error=None if linked_schedule is not None else "Binding points to a missing schedule event.",
        )

    try:
        due_at = _parse_datetime(todo.due_at)
        duration_minutes = _normalize_duration(schedule_duration_minutes)
        created_schedule = schedule_repository.add_schedule_event(
            todo.title,
            todo.detail,
            due_at,
            due_at + timedelta(minutes=duration_minutes),
        )
        binding = binding_repository.add_todo_schedule_binding(
            todo.id,
            created_schedule.id,
            link_type="todo_due_event",
        )
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=created_schedule,
            binding=binding,
            binding_error=None,
        )
    except Exception as exc:
        logger.warning("Failed to bind todo %s to a schedule event.", todo.id, exc_info=exc)
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=None,
            binding=None,
            binding_error=str(exc) or exc.__class__.__name__,
        )


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def _normalize_duration(value: int) -> int:
    duration = int(value)
    if duration <= 0:
        raise ValueError("schedule_duration_minutes must be greater than zero.")
    return duration
