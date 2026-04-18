"""Schedule CRUD routes."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status

from ...services import schedule_service
from ..schemas.schedule import (
    ScheduleCreateRequest,
    ScheduleResponse,
    ScheduleUpdateRequest,
    serialize_schedule,
)


router = APIRouter()


@router.get("/api/schedules", response_model=list[ScheduleResponse])
async def read_schedules(include_cancelled: bool = Query(default=True)) -> list[ScheduleResponse]:
    return [serialize_schedule(item) for item in schedule_service.list_schedules(include_cancelled=include_cancelled)]


@router.get("/api/schedules/range", response_model=list[ScheduleResponse])
async def read_schedules_range(start: str, end: str, include_cancelled: bool = Query(default=False)) -> list[ScheduleResponse]:
    items = schedule_service.list_schedules_in_range(start, end, include_cancelled=include_cancelled)
    return [serialize_schedule(item) for item in items]


@router.get("/api/schedules/{event_id}", response_model=ScheduleResponse)
async def read_schedule(event_id: int) -> ScheduleResponse:
    sched = schedule_service.get_schedule(event_id)
    if sched is None:
        raise HTTPException(status_code=404, detail=f"Schedule event {event_id} does not exist.")
    return serialize_schedule(sched)


@router.post("/api/schedules", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule(payload: ScheduleCreateRequest) -> ScheduleResponse:
    schedule = schedule_service.create_schedule(
        title=payload.title,
        detail=payload.detail,
        start_at=payload.startAt,
        end_at=payload.endAt,
        all_day=payload.allDay,
        timezone_name=payload.timezone,
        location=payload.location,
        reminder_offsets=payload.reminderOffsets,
        recurrence=payload.recurrence,
        recurrence_end=payload.recurrenceEnd,
    )
    return serialize_schedule(schedule)


@router.patch("/api/schedules/{event_id}", response_model=ScheduleResponse)
async def patch_schedule(event_id: int, payload: ScheduleUpdateRequest) -> ScheduleResponse:
    if schedule_service.get_schedule(event_id) is None:
        raise HTTPException(status_code=404, detail=f"Schedule event {event_id} does not exist.")
    schedule = schedule_service.update_schedule(event_id, **payload.to_updates())
    return serialize_schedule(schedule)


@router.delete("/api/schedules/{event_id}")
async def remove_schedule(event_id: int) -> dict[str, bool]:
    if schedule_service.get_schedule(event_id) is None:
        raise HTTPException(status_code=404, detail=f"Schedule event {event_id} does not exist.")

    schedule_service.delete_schedule(event_id)
    return {"deleted": True}


@router.delete("/api/schedules")
async def clear_schedules(scope: Literal["all"] = Query(default="all")) -> dict[str, int]:
    return {"deletedCount": schedule_service.clear_schedules()}
