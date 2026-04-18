"""Repository interfaces and default persistence adapters."""

from .schedule_repository import ScheduleEvent, ScheduleRepository
from .tinydb.schedule_repository import TinyDbScheduleRepository
from .tinydb.todo_repository import TinyDbTodoRepository
from .todo_repository import UNSET, Todo, TodoRepository


todo_repository = TinyDbTodoRepository()
schedule_repository = TinyDbScheduleRepository()

__all__ = [
    "UNSET",
    "ScheduleEvent",
    "ScheduleRepository",
    "Todo",
    "TodoRepository",
    "schedule_repository",
    "todo_repository",
    "TinyDbScheduleRepository",
    "TinyDbTodoRepository",
]
