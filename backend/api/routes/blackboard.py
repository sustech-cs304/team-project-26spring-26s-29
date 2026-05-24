"""Blackboard integration routes."""

from fastapi import APIRouter, Query

from ...services.blackboard_service import BlackboardCookie, blackboard_service
from ..schemas.blackboard import (
    BlackboardCookieRequest,
    BlackboardLoginRequest,
    BlackboardSessionRequest,
    BlackboardSuggestionIdsRequest,
    BlackboardSuggestionResponse,
    serialize_cookie,
    serialize_state,
    serialize_suggestion,
)


router = APIRouter()


@router.get("/api/blackboard/status")
async def read_blackboard_status() -> dict[str, object]:
    return serialize_state(blackboard_service.get_status())


@router.post("/api/blackboard/login")
async def login_blackboard(payload: BlackboardLoginRequest) -> dict[str, object]:
    return serialize_state(blackboard_service.login(payload.username, payload.password))


@router.post("/api/blackboard/refresh")
async def refresh_blackboard_status() -> dict[str, object]:
    return serialize_state(blackboard_service.refresh_status())


@router.get("/api/blackboard/session-cookies", response_model=list[BlackboardCookieRequest])
async def list_blackboard_session_cookies() -> list[BlackboardCookieRequest]:
    return [serialize_cookie(cookie) for cookie in blackboard_service.get_session_cookies()]


@router.post("/api/blackboard/session")
async def save_blackboard_session(payload: BlackboardSessionRequest) -> dict[str, object]:
    cookies = [
        BlackboardCookie(
            name=cookie.name,
            value=cookie.value,
            domain=cookie.domain,
            path=cookie.path,
        )
        for cookie in payload.cookies
    ]
    return serialize_state(blackboard_service.set_session(cookies))


@router.delete("/api/blackboard/session")
async def clear_blackboard_session() -> dict[str, object]:
    return serialize_state(blackboard_service.clear_session())


@router.post("/api/blackboard/sync")
async def sync_blackboard() -> dict[str, object]:
    return serialize_state(blackboard_service.sync())


@router.get("/api/blackboard/suggestions", response_model=list[BlackboardSuggestionResponse])
async def list_blackboard_suggestions(status: str = Query(default="pending")) -> list[BlackboardSuggestionResponse]:
    return [serialize_suggestion(item) for item in blackboard_service.list_suggestions(status)]


@router.post("/api/blackboard/suggestions/apply")
async def apply_blackboard_suggestions(payload: BlackboardSuggestionIdsRequest) -> dict[str, object]:
    result = blackboard_service.apply_suggestions(payload.ids)
    return {
        "appliedCount": result["appliedCount"],
        "suggestions": [serialize_suggestion(item) for item in result["suggestions"]],
    }


@router.post("/api/blackboard/suggestions/dismiss")
async def dismiss_blackboard_suggestions(payload: BlackboardSuggestionIdsRequest) -> dict[str, object]:
    result = blackboard_service.dismiss_suggestions(payload.ids)
    return {
        "dismissedCount": result["dismissedCount"],
        "suggestions": [serialize_suggestion(item) for item in result["suggestions"]],
    }
