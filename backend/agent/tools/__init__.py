"""Agent tool adapters."""

from .todo_tool import TODO_TOOLS, manage_todo_list, todo_tool
from .schedule_tool import SCHEDULE_TOOLS, manage_schedule, schedule_tool

# Keep `TODO_TOOLS` unchanged for tests that expect the original todo-only list.
# Provide a combined `TOOLS` list for runtime registration.
TOOLS = TODO_TOOLS + SCHEDULE_TOOLS

__all__ = [
	"TODO_TOOLS",
	"manage_todo_list",
	"todo_tool",
	"SCHEDULE_TOOLS",
	"manage_schedule",
	"schedule_tool",
	"TOOLS",
]
