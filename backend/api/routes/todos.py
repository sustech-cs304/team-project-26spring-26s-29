"""Todo CRUD routes."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status

from ...db import add_todo, delete_all_todos, delete_todo, get_todo, list_todos, update_todo
from ..schemas.todo import TodoCreateRequest, TodoResponse, TodoUpdateRequest, serialize_todo


router = APIRouter()


@router.get("/api/todos", response_model=list[TodoResponse])
async def read_todos() -> list[TodoResponse]:
    return [serialize_todo(item) for item in list_todos()]


@router.get("/api/todos/{todo_id}", response_model=TodoResponse)
async def read_todo(todo_id: int) -> TodoResponse:
    todo = get_todo(todo_id)
    if todo is None:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.")
    return serialize_todo(todo)


@router.post("/api/todos", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
async def create_todo(payload: TodoCreateRequest) -> TodoResponse:
    todo = add_todo(title=payload.title, detail=payload.detail, due_at=payload.dueAt)
    return serialize_todo(todo)


@router.patch("/api/todos/{todo_id}", response_model=TodoResponse)
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

    return serialize_todo(todo)


@router.delete("/api/todos/{todo_id}")
async def remove_todo(todo_id: int) -> dict[str, bool]:
    deleted = delete_todo(todo_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Todo item {todo_id} does not exist.")
    return {"deleted": True}


@router.delete("/api/todos")
async def clear_todos(scope: Literal["all", "completed"] = Query(default="all")) -> dict[str, int]:
    if scope == "all":
        return {"deletedCount": delete_all_todos()}

    deleted_count = 0
    for item in list_todos():
        if item.is_done and delete_todo(item.id):
            deleted_count += 1

    return {"deletedCount": deleted_count}
