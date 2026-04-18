"""Todo CRUD routes."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status

from ...services import UNSET, todo_service
from ..schemas.todo import TodoCreateRequest, TodoResponse, TodoUpdateRequest, serialize_todo


router = APIRouter()


@router.get("/api/todos", response_model=list[TodoResponse])
async def read_todos() -> list[TodoResponse]:
    return [serialize_todo(item) for item in todo_service.list_todos()]


@router.get("/api/todos/{todo_id}", response_model=TodoResponse)
async def read_todo(todo_id: int) -> TodoResponse:
    todo = todo_service.get_todo(todo_id)
    if todo is None:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.")
    return serialize_todo(todo)


@router.post("/api/todos", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
async def create_todo(payload: TodoCreateRequest) -> TodoResponse:
    todo = todo_service.create_todo(title=payload.title, detail=payload.detail, due_at=payload.dueAt)
    return serialize_todo(todo)


@router.patch("/api/todos/{todo_id}", response_model=TodoResponse)
async def patch_todo(todo_id: int, payload: TodoUpdateRequest) -> TodoResponse:
    try:
        todo = todo_service.update_todo(
            todo_id,
            title=payload.title,
            detail=payload.detail,
            due_at=payload.dueAt if "dueAt" in payload.model_fields_set else UNSET,
            is_done=payload.isDone,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return serialize_todo(todo)


@router.delete("/api/todos/{todo_id}")
async def remove_todo(todo_id: int) -> dict[str, bool]:
    deleted = todo_service.delete_todo(todo_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.")
    return {"deleted": True}


@router.delete("/api/todos")
async def clear_todos(scope: Literal["all", "completed"] = Query(default="all")) -> dict[str, int]:
    return {"deletedCount": todo_service.clear_todos(scope)}
