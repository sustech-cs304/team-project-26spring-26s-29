"""Health and runtime config routes."""

from fastapi import APIRouter

from ...config import get_config, set_config
from ..schemas.agent import RuntimeConfigRequest


router = APIRouter()


@router.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@router.get("/api/config")
async def read_runtime_config() -> dict[str, str | bool | None]:
    return get_config()


@router.post("/api/config")
async def write_runtime_config(payload: RuntimeConfigRequest) -> dict[str, str | bool | None]:
    return set_config(payload.model_dump())
