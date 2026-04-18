"""Schemas for todo endpoints."""

from datetime import datetime
from typing import cast

from pydantic import BaseModel, Field, field_validator, model_validator

from ...repositories import Todo, TodoUpdate


class TodoResponse(BaseModel):
    id: int
    title: str
    detail: str
    dueAt: str | None
    isDone: bool
    completedAt: str | None
    createdAt: str
    updatedAt: str


class TodoCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    detail: str = Field(default="", max_length=4000)
    dueAt: str | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title is empty.")
        return value

    @field_validator("dueAt")
    @classmethod
    def normalize_due_at(cls, value: str | None) -> str | None:
        return normalize_due_at(value)


class TodoUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    detail: str | None = Field(default=None, max_length=4000)
    dueAt: str | None = None
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

    @field_validator("dueAt")
    @classmethod
    def normalize_optional_due_at(cls, value: str | None) -> str | None:
        return normalize_due_at(value)

    @model_validator(mode="after")
    def ensure_valid_update(self) -> "TodoUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided for update.")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("title cannot be null.")
        if "detail" in self.model_fields_set and self.detail is None:
            raise ValueError("detail cannot be null.")
        if "isDone" in self.model_fields_set and self.isDone is None:
            raise ValueError("isDone cannot be null.")
        return self

    def to_updates(self) -> TodoUpdate:
        updates: TodoUpdate = {}
        if "title" in self.model_fields_set:
            updates["title"] = cast(str, self.title)
        if "detail" in self.model_fields_set:
            updates["detail"] = cast(str, self.detail)
        if "dueAt" in self.model_fields_set:
            updates["due_at"] = self.dueAt
        if "isDone" in self.model_fields_set:
            updates["is_done"] = cast(bool, self.isDone)
        return updates


def normalize_due_at(value: str | None) -> str | None:
    if value is None:
        return None

    text = value.strip()
    if not text:
        return None

    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("dueAt must be an ISO datetime string or null.") from exc

    return text


def serialize_todo(todo: Todo) -> TodoResponse:
    return TodoResponse(
        id=todo.id,
        title=todo.title,
        detail=todo.detail,
        dueAt=todo.due_at,
        isDone=todo.is_done,
        completedAt=todo.completed_at,
        createdAt=todo.created_at,
        updatedAt=todo.updated_at,
    )
