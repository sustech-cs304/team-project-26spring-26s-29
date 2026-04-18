"""Schemas for agent and runtime config endpoints."""

from pydantic import BaseModel, Field, ValidationError, field_validator


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message is empty.")
        return value


class RuntimeConfigRequest(BaseModel):
    dbPath: str | None = None
    openaiApiKey: str | None = None
    openaiChatModel: str | None = None
    openaiEndpoint: str | None = None


def format_validation_error(error: ValidationError) -> str:
    detail = error.errors()[0]
    return detail.get("msg", "Invalid request.")
