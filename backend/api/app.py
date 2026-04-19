"""Application factory for the backend API."""

from fastapi import FastAPI

from .routes.agent import router as agent_router
from .routes.config import router as config_router
from .routes.todos import router as todo_router
from .routes.schedules import router as schedules_router


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(config_router)
    app.include_router(todo_router)
    app.include_router(schedules_router)
    app.include_router(agent_router)
    return app
