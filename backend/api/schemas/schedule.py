"""Schemas for schedule endpoints."""

from datetime import datetime
from typing import cast

from pydantic import BaseModel, Field, field_validator, model_validator

from ...repositories import ScheduleEvent


class ScheduleResponse(BaseModel):
    id: int
    title: str
    detail: str
    startAt: str
    endAt: str
    allDay: bool
    timezone: str
    location: str | None
    isCancelled: bool
    isDone: bool
    completedAt: str | None
    reminderOffsets: list[int]
    recurrence: str | None
    recurrenceEnd: str | None
    createdAt: str
    updatedAt: str
    startDay: str
    endDay: str
    startTs: int
    endTs: int


class ScheduleCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    detail: str = Field(default="", max_length=4000)
    startAt: str
    endAt: str
    allDay: bool = False
    timezone: str | None = None
    location: str | None = None
    reminderOffsets: list[int] | None = None
    recurrence: str | None = None
    recurrenceEnd: str | None = None
    isDone: bool | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title is empty.")
        return value

    @field_validator("startAt", "endAt")
    @classmethod
    def validate_iso_datetime(cls, value: str) -> str:
        return normalize_schedule_datetime(value)


class ScheduleUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    detail: str | None = Field(default=None, max_length=4000)
    startAt: str | None = None
    endAt: str | None = None
    allDay: bool | None = None
    timezone: str | None = None
    location: str | None = None
    reminderOffsets: list[int] | None = None
    recurrence: str | None = None
    recurrenceEnd: str | None = None
    isDone: bool | None = None

    @field_validator("title")
    @classmethod
    def normalize_optional_title(cls, value: str | None) -> str | None:
        if value is None:
            return None

        value = value.strip()
        if not value:
            raise ValueError("Title is empty.")
        return value

    @field_validator("startAt", "endAt")
    @classmethod
    def normalize_optional_schedule_datetime(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_schedule_datetime(value)

    @model_validator(mode="after")
    def ensure_valid_update(self) -> "ScheduleUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided for update.")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("title cannot be null.")
        if "detail" in self.model_fields_set and self.detail is None:
            raise ValueError("detail cannot be null.")
        if "startAt" in self.model_fields_set and self.startAt is None:
            raise ValueError("startAt cannot be null.")
        if "endAt" in self.model_fields_set and self.endAt is None:
            raise ValueError("endAt cannot be null.")
        if "allDay" in self.model_fields_set and self.allDay is None:
            raise ValueError("allDay cannot be null.")
        if "timezone" in self.model_fields_set and self.timezone is None:
            raise ValueError("timezone cannot be null.")
        if "isDone" in self.model_fields_set and self.isDone is None:
            raise ValueError("isDone cannot be null.")
        return self

    def to_updates(self) -> dict[str, object]:
        updates: dict[str, object] = {}
        if "title" in self.model_fields_set:
            updates["title"] = cast(str, self.title)
        if "detail" in self.model_fields_set:
            updates["detail"] = cast(str, self.detail)
        if "startAt" in self.model_fields_set:
            updates["start_at"] = self.startAt
        if "endAt" in self.model_fields_set:
            updates["end_at"] = self.endAt
        if "allDay" in self.model_fields_set:
            updates["all_day"] = cast(bool, self.allDay)
        if "timezone" in self.model_fields_set:
            updates["timezone_name"] = self.timezone
        if "location" in self.model_fields_set:
            updates["location"] = self.location
        if "reminderOffsets" in self.model_fields_set:
            updates["reminder_offsets"] = self.reminderOffsets
        if "recurrence" in self.model_fields_set:
            updates["recurrence"] = self.recurrence
        if "recurrenceEnd" in self.model_fields_set:
            updates["recurrence_end"] = self.recurrenceEnd
        if "isDone" in self.model_fields_set:
            updates["is_done"] = cast(bool, self.isDone)
        return updates


def normalize_schedule_datetime(value: str) -> str:
    text = value.strip()
    if not text:
        raise ValueError("startAt/endAt must be an ISO datetime string.")

    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("startAt/endAt must be an ISO datetime string.") from exc

    return text


def serialize_schedule(schedule: ScheduleEvent) -> ScheduleResponse:
    return ScheduleResponse(
        id=schedule.id,
        title=schedule.title,
        detail=schedule.detail,
        startAt=schedule.start_at,
        endAt=schedule.end_at,
        allDay=schedule.all_day,
        timezone=schedule.timezone,
        location=schedule.location,
        isCancelled=schedule.is_cancelled,
        isDone=getattr(schedule, "is_done", False),
        completedAt=getattr(schedule, "completed_at", None),
        reminderOffsets=getattr(schedule, "reminder_offsets", []),
        recurrence=getattr(schedule, "recurrence", None),
        recurrenceEnd=getattr(schedule, "recurrence_end", None),
        createdAt=schedule.created_at,
        updatedAt=schedule.updated_at,
        startDay=schedule.start_day,
        endDay=schedule.end_day,
        startTs=schedule.start_ts,
        endTs=schedule.end_ts,
    )
