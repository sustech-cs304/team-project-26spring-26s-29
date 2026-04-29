"""Best-effort helpers for auto-generated todo-to-schedule bindings."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from ..repositories import ScheduleEvent, ScheduleRepository, Todo, schedule_repository
from ..repositories.binding_repository import (
    BindingRepository,
    TodoScheduleBinding,
    binding_repository,
)


logger = logging.getLogger(__name__)
DEFAULT_SCHEDULE_DURATION_MINUTES = 30
TODO_DUE_EVENT_LINK_TYPE = "todo_due_event"


@dataclass(frozen=True, slots=True)
class TodoScheduleBindingResult:
    todo: Todo | None
    created_schedule: ScheduleEvent | None
    binding: TodoScheduleBinding | None
    binding_error: str | None


def bind_after_todo_created(
    todo: Todo,
    *,
    schedule_duration_minutes: int = DEFAULT_SCHEDULE_DURATION_MINUTES,
    schedule_repo: ScheduleRepository = schedule_repository,
    binding_repo: BindingRepository = binding_repository,
) -> TodoScheduleBindingResult:
    return sync_after_todo_upserted(
        todo,
        schedule_duration_minutes=schedule_duration_minutes,
        schedule_repo=schedule_repo,
        binding_repo=binding_repo,
    )


def sync_after_todo_upserted(
    todo: Todo,
    *,
    schedule_duration_minutes: int = DEFAULT_SCHEDULE_DURATION_MINUTES,
    schedule_repo: ScheduleRepository = schedule_repository,
    binding_repo: BindingRepository = binding_repository,
) -> TodoScheduleBindingResult:
    existing_binding = binding_repo.get_binding_by_todo_id(todo.id)
    if todo.due_at is None:
        if existing_binding is None:
            return TodoScheduleBindingResult(
                todo=todo,
                created_schedule=None,
                binding=None,
                binding_error=None,
            )
        return _delete_binding_and_auto_schedule(
            existing_binding,
            todo=todo,
            schedule_repo=schedule_repo,
            binding_repo=binding_repo,
        )

    duration_minutes = _normalize_duration(schedule_duration_minutes)

    if existing_binding is None:
        return _create_binding_for_todo(
            todo,
            duration_minutes=duration_minutes,
            schedule_repo=schedule_repo,
            binding_repo=binding_repo,
        )

    linked_schedule = schedule_repo.get_schedule_event(existing_binding.schedule_event_id)
    if linked_schedule is None:
        binding_repo.delete_binding(existing_binding.id)
        return _create_binding_for_todo(
            todo,
            duration_minutes=duration_minutes,
            schedule_repo=schedule_repo,
            binding_repo=binding_repo,
        )

    if existing_binding.link_type != TODO_DUE_EVENT_LINK_TYPE:
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=linked_schedule,
            binding=existing_binding,
            binding_error=None,
        )

    try:
        due_at = _parse_datetime(todo.due_at)
        duration = _bound_duration_or_default(linked_schedule, duration_minutes)
        updated_schedule = schedule_repo.update_schedule_event(
            linked_schedule.id,
            title=todo.title,
            detail=todo.detail,
            start_at=due_at,
            end_at=due_at + timedelta(minutes=duration),
            is_done=todo.is_done,
        )
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=updated_schedule,
            binding=existing_binding,
            binding_error=None,
        )
    except Exception as exc:
        logger.warning("Failed to synchronize todo %s binding.", todo.id, exc_info=exc)
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=linked_schedule,
            binding=existing_binding,
            binding_error=str(exc) or exc.__class__.__name__,
        )


def cleanup_after_todo_deleted(
    todo_id: int,
    *,
    schedule_repo: ScheduleRepository = schedule_repository,
    binding_repo: BindingRepository = binding_repository,
) -> bool:
    binding = binding_repo.get_binding_by_todo_id(todo_id)
    if binding is None:
        return False

    result = _delete_binding_and_auto_schedule(
        binding,
        todo=None,
        schedule_repo=schedule_repo,
        binding_repo=binding_repo,
    )
    return result.binding is None and result.binding_error is None


def cleanup_after_schedule_deleted(
    schedule_event_id: int,
    *,
    binding_repo: BindingRepository = binding_repository,
) -> bool:
    return binding_repo.delete_binding_by_schedule_event_id(schedule_event_id)


def _create_binding_for_todo(
    todo: Todo,
    *,
    duration_minutes: int,
    schedule_repo: ScheduleRepository,
    binding_repo: BindingRepository,
) -> TodoScheduleBindingResult:
    try:
        due_at = _parse_datetime(todo.due_at)
        created_schedule = schedule_repo.add_schedule_event(
            todo.title,
            todo.detail,
            due_at,
            due_at + timedelta(minutes=duration_minutes),
            is_done=todo.is_done,
        )
        binding = binding_repo.add_todo_schedule_binding(
            todo.id,
            created_schedule.id,
            link_type=TODO_DUE_EVENT_LINK_TYPE,
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


def _delete_binding_and_auto_schedule(
    binding: TodoScheduleBinding,
    *,
    todo: Todo | None,
    schedule_repo: ScheduleRepository,
    binding_repo: BindingRepository,
) -> TodoScheduleBindingResult:
    linked_schedule = schedule_repo.get_schedule_event(binding.schedule_event_id)
    try:
        if binding.link_type == TODO_DUE_EVENT_LINK_TYPE and linked_schedule is not None:
            schedule_repo.delete_schedule_event(linked_schedule.id)
        binding_repo.delete_binding(binding.id)
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=None,
            binding=None,
            binding_error=None,
        )
    except Exception as exc:
        todo_id = todo.id if todo is not None else binding.todo_id
        logger.warning("Failed to clean up binding for todo %s.", todo_id, exc_info=exc)
        return TodoScheduleBindingResult(
            todo=todo,
            created_schedule=linked_schedule,
            binding=binding,
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


def _bound_duration_or_default(schedule: ScheduleEvent, default_minutes: int) -> int:
    start_at = _parse_datetime(schedule.start_at)
    end_at = _parse_datetime(schedule.end_at)
    duration_seconds = int((end_at - start_at).total_seconds())
    if duration_seconds <= 0:
        return default_minutes
    return max(duration_seconds // 60, 1)
