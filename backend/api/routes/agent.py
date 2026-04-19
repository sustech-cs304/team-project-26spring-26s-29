"""Agent HTTP and WebSocket routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ...agent import create_run, run_prompt
from ..schemas.agent import (
    ApprovalResponseRequest,
    RunRequest,
    StreamRunRequest,
    format_validation_error,
)
from ..websocket import close_websocket, send_websocket_json


router = APIRouter()


@router.post("/api/agent/run")
async def run_agent(payload: RunRequest) -> dict[str, Any]:
    try:
        message = await run_prompt(_dump_input_parts(payload))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Agent request failed: {exc}") from exc

    return {
        "message": message,
        "agent": "openai-chat",
        "requestId": payload.requestId,
    }


@router.websocket("/api/agent/run")
async def run_agent_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    request_id: str | None = None
    controller = None

    try:
        payload = StreamRunRequest.model_validate(await websocket.receive_json())
        request_id = payload.requestId
        controller = create_run()

        async def send_update(message: dict[str, Any]) -> None:
            await send_websocket_json(
                websocket,
                {"type": "update", "requestId": request_id, "message": message},
            )

        message = await controller.start(
            _dump_input_parts(payload),
            send_update,
        )

        while message["status"] == "needs_approval":
            await send_update(message)
            approval_payload = ApprovalResponseRequest.model_validate(await websocket.receive_json())
            if approval_payload.requestId != request_id:
                raise ValueError("Approval response requestId does not match the active run.")
            message = await controller.respond_to_approval(
                approval_payload.approvalId,
                approval_payload.approved,
                send_update,
            )

        await send_websocket_json(
            websocket,
            {
                "type": "done",
                "requestId": request_id,
                "message": message,
                "agent": "openai-chat",
            },
        )
    except ValidationError as exc:
        try:
            await send_websocket_json(
                websocket,
                {"type": "error", "requestId": request_id, "error": format_validation_error(exc)},
            )
        except WebSocketDisconnect:
            if controller is not None:
                controller.handle_disconnect()
            return
    except WebSocketDisconnect:
        if controller is not None:
            controller.handle_disconnect()
        return
    except Exception as exc:
        try:
            await send_websocket_json(
                websocket,
                {"type": "error", "requestId": request_id, "error": f"Agent request failed: {exc}"},
            )
        except WebSocketDisconnect:
            return
    finally:
        await close_websocket(websocket)


def _dump_input_parts(payload: RunRequest) -> list[dict[str, Any]]:
    return [part.model_dump() for part in payload.contents]
