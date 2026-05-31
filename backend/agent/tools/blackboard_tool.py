"""Blackboard sync tools for the agent."""

from __future__ import annotations

from typing import Annotated, Any

from agent_framework import tool
from pydantic import Field

from ...repositories.blackboard_repository import BlackboardSuggestion
from ...services import blackboard_service


BLACKBOARD_TOOL_SCOPE = (
    "Use these tools only for the user's SUSTech Blackboard course data, such as "
    "announcements, assignments, course content, gradebook deadlines, and generated "
    "planning suggestions. These tools use the existing logged-in Blackboard session "
    "captured by the app. Never ask for, store, echo, or pass around the user's SID, "
    "password, CAS ticket, or raw cookies. If login is required, tell the user to sign "
    "in through the app's Blackboard login window first."
)


def get_blackboard_status() -> dict[str, Any]:
    """Read the current Blackboard connection status."""
    return {
        "action": "status",
        "status": _serialize_state(blackboard_service.get_status()),
    }


def sync_blackboard() -> dict[str, Any]:
    """Sync Blackboard data from the existing authenticated app session."""
    return {
        "action": "sync",
        "status": _serialize_state(blackboard_service.sync()),
    }


def list_blackboard_suggestions(
    status: Annotated[
        str,
        Field(description="Suggestion status to list: pending, applied, dismissed, or all."),
    ] = "pending",
) -> dict[str, Any]:
    """List Blackboard-generated planning suggestions."""
    suggestions = [
        _serialize_suggestion(suggestion)
        for suggestion in blackboard_service.list_suggestions(status)
    ]
    return {
        "action": "list_suggestions",
        "status": status,
        "count": len(suggestions),
        "suggestions": suggestions,
    }


def apply_blackboard_suggestions(
    ids: Annotated[
        list[int],
        Field(description="Blackboard suggestion ids to apply to todo or schedule."),
    ],
) -> dict[str, Any]:
    """Apply selected Blackboard suggestions to todo or schedule."""
    result = blackboard_service.apply_suggestions(ids)
    return {
        "action": "apply_suggestions",
        "applied_count": result["appliedCount"],
        "suggestions": [
            _serialize_suggestion(suggestion)
            for suggestion in result["suggestions"]
        ],
    }


def dismiss_blackboard_suggestions(
    ids: Annotated[
        list[int],
        Field(description="Blackboard suggestion ids to dismiss."),
    ],
) -> dict[str, Any]:
    """Dismiss selected Blackboard suggestions."""
    result = blackboard_service.dismiss_suggestions(ids)
    return {
        "action": "dismiss_suggestions",
        "dismissed_count": result["dismissedCount"],
        "suggestions": [
            _serialize_suggestion(suggestion)
            for suggestion in result["suggestions"]
        ],
    }


get_blackboard_status_tool = tool(
    name="get_blackboard_status",
    description=(
        "Read whether the app currently has a usable SUSTech Blackboard session. "
        f"{BLACKBOARD_TOOL_SCOPE}"
    ),
    approval_mode="never_require",
)(get_blackboard_status)

sync_blackboard_tool = tool(
    name="sync_blackboard",
    description=(
        "Fetch current SUSTech Blackboard course data through the existing app session "
        "and update local Blackboard suggestions. "
        f"{BLACKBOARD_TOOL_SCOPE}"
    ),
    approval_mode="always_require",
)(sync_blackboard)

list_blackboard_suggestions_tool = tool(
    name="list_blackboard_suggestions",
    description=(
        "Read local Blackboard planning suggestions generated from synced course data. "
        f"{BLACKBOARD_TOOL_SCOPE}"
    ),
    approval_mode="never_require",
)(list_blackboard_suggestions)

apply_blackboard_suggestions_tool = tool(
    name="apply_blackboard_suggestions",
    description=(
        "Apply selected Blackboard suggestions to the user's local todo or schedule. "
        f"{BLACKBOARD_TOOL_SCOPE}"
    ),
    approval_mode="always_require",
)(apply_blackboard_suggestions)

dismiss_blackboard_suggestions_tool = tool(
    name="dismiss_blackboard_suggestions",
    description=(
        "Dismiss selected local Blackboard suggestions after review. "
        f"{BLACKBOARD_TOOL_SCOPE}"
    ),
    approval_mode="always_require",
)(dismiss_blackboard_suggestions)

BLACKBOARD_TOOLS = [
    get_blackboard_status_tool,
    sync_blackboard_tool,
    list_blackboard_suggestions_tool,
    apply_blackboard_suggestions_tool,
    dismiss_blackboard_suggestions_tool,
]


def _serialize_state(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "connected": bool(state.get("connected")),
        "needs_login": bool(state.get("needs_login", True)),
        "has_session": bool(state.get("has_session")),
        "user": state.get("user"),
        "learn_version": state.get("learn_version"),
        "last_sync_at": state.get("last_sync_at"),
        "last_error": state.get("last_error"),
        "last_summary": state.get("last_summary"),
        "updated_at": state.get("updated_at"),
    }


def _serialize_suggestion(suggestion: BlackboardSuggestion) -> dict[str, Any]:
    return {
        "id": suggestion.id,
        "source_key": suggestion.source_key,
        "source_hash": suggestion.source_hash,
        "source_type": suggestion.source_type,
        "course_id": suggestion.course_id,
        "course_name": suggestion.course_name,
        "action": suggestion.action,
        "status": suggestion.status,
        "title": suggestion.title,
        "detail": suggestion.detail,
        "due_at": suggestion.due_at,
        "start_at": suggestion.start_at,
        "end_at": suggestion.end_at,
        "confidence": suggestion.confidence,
        "reason": suggestion.reason,
        "target_id": suggestion.target_id,
        "created_at": suggestion.created_at,
        "updated_at": suggestion.updated_at,
    }
