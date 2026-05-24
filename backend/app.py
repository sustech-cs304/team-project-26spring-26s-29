"""Backend application entry point."""

from fastapi import FastAPI

from .api.routes.agent import router as agent_router
from .api.routes.blackboard import router as blackboard_router
from .api.routes.config import router as config_router
from .api.routes.schedules import router as schedules_router
from .api.routes.todos import router as todo_router


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(config_router)
    app.include_router(todo_router)
    app.include_router(schedules_router)
    app.include_router(blackboard_router)
    app.include_router(agent_router)
    return app


app = create_app()
