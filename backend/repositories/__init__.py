"""Repository interfaces and default persistence adapters."""

from .schedule_repository import ScheduleEvent, ScheduleRepository
from .tinydb.schedule_repository import TinyDbScheduleRepository
from .tinydb.todo_repository import TinyDbTodoRepository
from .todo_repository import Todo, TodoRepository, TodoUpdate


todo_repository = TinyDbTodoRepository()
schedule_repository = TinyDbScheduleRepository()

__all__ = [
    "ScheduleEvent",
    "ScheduleRepository",
    "Todo",
    "TodoRepository",
    "TodoUpdate",
    "schedule_repository",
    "todo_repository",
    "TinyDbScheduleRepository",
    "TinyDbTodoRepository",
]
