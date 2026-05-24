"""Repository interfaces and default persistence adapters."""

from .blackboard_repository import BlackboardRemoteItem, BlackboardRepository, BlackboardSuggestion
from .schedule_repository import ScheduleEvent, ScheduleRepository
from .tinydb.blackboard_repository import TinyDbBlackboardRepository
from .tinydb.schedule_repository import TinyDbScheduleRepository
from .tinydb.todo_repository import TinyDbTodoRepository
from .todo_repository import Todo, TodoRepository, TodoUpdate


todo_repository = TinyDbTodoRepository()
schedule_repository = TinyDbScheduleRepository()
blackboard_repository = TinyDbBlackboardRepository()

__all__ = [
    "BlackboardRemoteItem",
    "BlackboardRepository",
    "BlackboardSuggestion",
    "ScheduleEvent",
    "ScheduleRepository",
    "Todo",
    "TodoRepository",
    "TodoUpdate",
    "blackboard_repository",
    "schedule_repository",
    "todo_repository",
    "TinyDbBlackboardRepository",
    "TinyDbScheduleRepository",
    "TinyDbTodoRepository",
]
