"""Agent HTTP and WebSocket routes."""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ...agent_service import run_prompt, stream_prompt
from ..schemas.agent import RunRequest, format_validation_error
from ..websocket import close_websocket, send_websocket_json


router = APIRouter()


@router.post("/api/agent/run")
async def run_agent(payload: RunRequest) -> dict[str, str]:
    try:
        reply = await run_prompt(payload.message)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Agent request failed: {exc}") from exc

    return {"reply": reply, "agent": "openai-chat"}


@router.websocket("/api/agent/run")
async def run_agent_stream(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        payload = RunRequest.model_validate(await websocket.receive_json())
        reply = await stream_prompt(
            payload.message,
            lambda chunk: send_websocket_json(websocket, {"type": "chunk", "chunk": chunk}),
        )
        await send_websocket_json(websocket, {"type": "done", "reply": reply, "agent": "openai-chat"})
    except Exception as exc:
        from pydantic import ValidationError

        if isinstance(exc, ValidationError):
            try:
                await send_websocket_json(websocket, {"type": "error", "error": format_validation_error(exc)})
            except WebSocketDisconnect:
                return
        elif isinstance(exc, WebSocketDisconnect):
            return
        else:
            try:
                await send_websocket_json(websocket, {"type": "error", "error": f"Agent request failed: {exc}"})
            except WebSocketDisconnect:
                return
    finally:
        await close_websocket(websocket)
