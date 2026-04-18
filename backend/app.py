from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from starlette.websockets import WebSocketState

from .agent_service import run_prompt, stream_prompt
from .config import get_config, set_config
from .db import Todo, add_todo, delete_all_todos, delete_todo, get_todo, list_todos, update_todo


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
        return _normalize_due_at(value)


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
        return _normalize_due_at(value)

    @model_validator(mode="after")
    def ensure_any_field_provided(self) -> "TodoUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided for update.")
        return self


app = FastAPI()


def format_validation_error(error: ValidationError) -> str:
    detail = error.errors()[0]
    return detail.get("msg", "Invalid request.")


def _normalize_due_at(value: str | None) -> str | None:
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


def _serialize_todo(todo: Todo) -> TodoResponse:
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


@app.get("/api/todos", response_model=list[TodoResponse])
async def read_todos() -> list[TodoResponse]:
    return [_serialize_todo(item) for item in list_todos()]


@app.get("/api/todos/{todo_id}", response_model=TodoResponse)
async def read_todo(todo_id: int) -> TodoResponse:
    todo = get_todo(todo_id)
    if todo is None:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.")
    return _serialize_todo(todo)


@app.post("/api/todos", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
async def create_todo(payload: TodoCreateRequest) -> TodoResponse:
    todo = add_todo(title=payload.title, detail=payload.detail, due_at=payload.dueAt)
    return _serialize_todo(todo)


@app.patch("/api/todos/{todo_id}", response_model=TodoResponse)
async def patch_todo(todo_id: int, payload: TodoUpdateRequest) -> TodoResponse:
    updates: dict[str, object] = {}

    if payload.title is not None:
        updates["title"] = payload.title
    if payload.detail is not None:
        updates["detail"] = payload.detail
    if "dueAt" in payload.model_fields_set:
        updates["due_at"] = payload.dueAt
    if payload.isDone is not None:
        updates["is_done"] = payload.isDone

    try:
        todo = update_todo(todo_id, **updates)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _serialize_todo(todo)


@app.delete("/api/todos/{todo_id}")
async def remove_todo(todo_id: int) -> dict[str, bool]:
    deleted = delete_todo(todo_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.")
    return {"deleted": True}


@app.delete("/api/todos")
async def clear_todos(scope: Literal["all", "completed"] = Query(default="all")) -> dict[str, int]:
    if scope == "all":
        return {"deletedCount": delete_all_todos()}

    deleted_count = 0
    for item in list_todos():
        if item.is_done and delete_todo(item.id):
            deleted_count += 1

    return {"deletedCount": deleted_count}


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
