from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError, field_validator
from starlette.websockets import WebSocketState

from .agent_service import run_prompt, stream_prompt
from .config import get_config, set_config


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
    openaiApiKey: str | None = None
    openaiChatModel: str | None = None
    openaiEndpoint: str | None = None


app = FastAPI()


def format_validation_error(error: ValidationError) -> str:
    detail = error.errors()[0]
    return detail.get("msg", "Invalid request.")


async def close_websocket(websocket: WebSocket) -> None:
    if websocket.client_state == WebSocketState.DISCONNECTED:
        return
    if websocket.application_state == WebSocketState.DISCONNECTED:
        return
    await websocket.close()


async def send_websocket_json(websocket: WebSocket, payload: dict[str, str]) -> None:
    if websocket.client_state == WebSocketState.DISCONNECTED:
        raise WebSocketDisconnect()
    if websocket.application_state == WebSocketState.DISCONNECTED:
        raise WebSocketDisconnect()

    try:
        await websocket.send_json(payload)
    except RuntimeError as exc:
        raise WebSocketDisconnect() from exc


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/config")
async def read_runtime_config() -> dict[str, str | None]:
    return get_config()


@app.post("/api/config")
async def write_runtime_config(payload: RuntimeConfigRequest) -> dict[str, str | None]:
    return set_config(payload.model_dump())


@app.post("/api/agent/run")
async def run_agent(payload: RunRequest) -> dict[str, str]:
    try:
        reply = await run_prompt(payload.message)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Agent request failed: {exc}") from exc

    return {"reply": reply, "agent": "openai-chat"}


@app.websocket("/api/agent/run")
async def run_agent_stream(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        payload = RunRequest.model_validate(await websocket.receive_json())
        reply = await stream_prompt(
            payload.message,
            lambda chunk: send_websocket_json(websocket, {"type": "chunk", "chunk": chunk}),
        )
        await send_websocket_json(websocket, {"type": "done", "reply": reply, "agent": "openai-chat"})
    except ValidationError as exc:
        try:
            await send_websocket_json(websocket, {"type": "error", "error": format_validation_error(exc)})
        except WebSocketDisconnect:
            return
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await send_websocket_json(websocket, {"type": "error", "error": f"Agent request failed: {exc}"})
        except WebSocketDisconnect:
            return
    finally:
        await close_websocket(websocket)
