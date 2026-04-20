"""Schedule CRUD routes."""

from fastapi import APIRouter, HTTPException, Query, status

from ...services import schedule_service
from ..schemas.schedule import (
    ScheduleCreateRequest,
    ScheduleResponse,
    ScheduleUpdateRequest,
    serialize_schedule,
)


router = APIRouter()


@router.get("/api/schedules/range", response_model=list[ScheduleResponse])
async def read_schedules_range(start: str, end: str, include_cancelled: bool = Query(default=False)) -> list[ScheduleResponse]:
    try:
        items = schedule_service.list_schedules_in_range(start, end, include_cancelled=include_cancelled)
    except ValueError as e:
        # Invalid datetime parsing from input range
        raise HTTPException(status_code=400, detail=f"Invalid datetime range: {e}")
    except Exception:
        # Log full traceback for debugging and return 500 to caller
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal server error")

    return [serialize_schedule(item) for item in items]


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
