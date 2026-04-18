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
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception as exc:
            raise ValueError("startAt/endAt must be an ISO datetime string.") from exc
        return value


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

    @model_validator(mode="after")
    def ensure_valid_update(self) -> "ScheduleUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided for update.")
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
            updates["is_done"] = bool(self.isDone)
        return updates


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
        isDone=schedule.is_done,
        completedAt=schedule.completed_at,
        reminderOffsets=schedule.reminder_offsets,
        recurrence=schedule.recurrence,
        recurrenceEnd=schedule.recurrence_end,
        createdAt=schedule.created_at,
        updatedAt=schedule.updated_at,
        startDay=schedule.start_day,
        endDay=schedule.end_day,
        startTs=schedule.start_ts,
        endTs=schedule.end_ts,
    )
