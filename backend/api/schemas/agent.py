"""Schemas for agent and runtime config endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator


class TextInputPart(BaseModel):
    type: Literal["text"]
    text: str = Field(min_length=1, max_length=20000)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message is empty.")
        return value


class ImageInputPart(BaseModel):
    type: Literal["image"]
    name: str = Field(min_length=1, max_length=255)
    mediaType: str = Field(min_length=1, max_length=120)
    sizeBytes: int = Field(ge=0)
    relativePath: str = Field(min_length=1, max_length=500)
    dataBase64: str = Field(min_length=1)

    @field_validator("name", "mediaType", "dataBase64", "relativePath")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be empty.")
        return value


class FileInputPart(BaseModel):
    type: Literal["file"]
    name: str = Field(min_length=1, max_length=255)
    mediaType: str = Field(min_length=1, max_length=120)
    sizeBytes: int = Field(ge=0)
    relativePath: str = Field(min_length=1, max_length=500)
    summaryText: str | None = Field(default=None, max_length=5000)

    @field_validator("name", "mediaType", "relativePath")
    @classmethod
    def normalize_metadata(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be empty.")
        return value

    @field_validator("summaryText")
    @classmethod
    def normalize_summary(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


RunInputPart = Annotated[
    TextInputPart | ImageInputPart | FileInputPart,
    Field(discriminator="type"),
]


class RunRequest(BaseModel):
    requestId: str | None = Field(default=None, min_length=1, max_length=200)
    contents: list[RunInputPart] = Field(min_length=1, max_length=64)


class StreamRunRequest(RunRequest):
    type: Literal["run"] = "run"
    requestId: str = Field(min_length=1, max_length=200)


class ApprovalResponseRequest(BaseModel):
    type: Literal["approval_response"] = "approval_response"
    requestId: str = Field(min_length=1, max_length=200)
    approvalId: str = Field(min_length=1, max_length=200)
    approved: bool


class RuntimeConfigRequest(BaseModel):
    dbPath: str | None = None
    openaiApiKey: str | None = None
    openaiChatModel: str | None = None
    openaiEndpoint: str | None = None
    motdLanguage: Literal["zh-CN", "en"] = "zh-CN"
    workspacePath: str | None = None


def format_validation_error(error: ValidationError) -> str:
    detail = error.errors()[0]
    return detail.get("msg", "Invalid request.")
