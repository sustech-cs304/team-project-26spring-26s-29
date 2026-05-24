"""Schemas for Blackboard integration endpoints."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from ...repositories.blackboard_repository import BlackboardSuggestion


class BlackboardCookieRequest(BaseModel):
    name: str
    value: str
    domain: str | None = None
    path: str | None = None


class BlackboardSessionRequest(BaseModel):
    cookies: list[BlackboardCookieRequest] = Field(default_factory=list)


class BlackboardSuggestionResponse(BaseModel):
    id: int
    sourceKey: str
    sourceHash: str
    sourceType: str
    courseId: str | None
    courseName: str | None
    action: Literal["create_todo", "create_schedule", "ignore"]
    status: Literal["pending", "applied", "dismissed"]
    title: str
    detail: str
    dueAt: str | None
    startAt: str | None
    endAt: str | None
    confidence: float
    reason: str
    targetId: int | None
    createdAt: str
    updatedAt: str


class BlackboardSuggestionIdsRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)


def serialize_state(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "connected": bool(state.get("connected")),
        "needsLogin": bool(state.get("needs_login", True)),
        "hasSession": bool(state.get("has_session")),
        "user": state.get("user"),
        "learnVersion": state.get("learn_version"),
        "lastSyncAt": state.get("last_sync_at"),
        "lastError": state.get("last_error"),
        "lastSummary": state.get("last_summary"),
        "updatedAt": state.get("updated_at"),
    }


def serialize_suggestion(suggestion: BlackboardSuggestion) -> BlackboardSuggestionResponse:
    return BlackboardSuggestionResponse(
        id=suggestion.id,
        sourceKey=suggestion.source_key,
        sourceHash=suggestion.source_hash,
        sourceType=suggestion.source_type,
        courseId=suggestion.course_id,
        courseName=suggestion.course_name,
        action=suggestion.action,
        status=suggestion.status,
        title=suggestion.title,
        detail=suggestion.detail,
        dueAt=suggestion.due_at,
        startAt=suggestion.start_at,
        endAt=suggestion.end_at,
        confidence=suggestion.confidence,
        reason=suggestion.reason,
        targetId=suggestion.target_id,
        createdAt=suggestion.created_at,
        updatedAt=suggestion.updated_at,
    )
