"""Tests for agent-facing tool and context adapters."""

from types import SimpleNamespace

from backend.agent.context import CurrentInfoProvider
from backend.agent.tools import (
    TODO_TOOLS,
    create_todo,
    delete_todo,
    list_todos,
    update_todo,
)

from .support import AsyncBackendTestCase, BackendTestCase


class AgentToolTests(BackendTestCase):
    def test_todo_tools_round_trip(self) -> None:
        created = create_todo(title="Call teammate", detail="sync on PR")
        listed = list_todos()
        updated = update_todo(todo_id=created["todo"]["id"], is_done=True)
        deleted = delete_todo(todo_id=created["todo"]["id"])

        self.assertEqual(len(TODO_TOOLS), 4)
        self.assertEqual(created["action"], "create")
        self.assertEqual(listed["count"], 1)
        self.assertTrue(updated["todo"]["is_done"])
        self.assertTrue(deleted["deleted"])

    def test_update_todo_allows_noop(self) -> None:
        created = create_todo(title="Call teammate", detail="sync on PR")
        updated = update_todo(todo_id=created["todo"]["id"])
        self.assertEqual(updated["action"], "update")
        self.assertEqual(updated["todo"]["id"], created["todo"]["id"])

    def test_write_tools_require_approval_but_list_does_not(self) -> None:
        tool_modes = {tool.name: tool.approval_mode for tool in TODO_TOOLS}
        self.assertEqual(tool_modes["list_todos"], "never_require")
        self.assertEqual(tool_modes["create_todo"], "always_require")
        self.assertEqual(tool_modes["update_todo"], "always_require")
        self.assertEqual(tool_modes["delete_todo"], "always_require")


class AgentContextTests(AsyncBackendTestCase):
    async def test_current_info_provider_injects_snapshot(self) -> None:
        create_todo(title="Review commit", detail="")
        provider = CurrentInfoProvider()
        session = SimpleNamespace(session_id="ctx-7", state={})

        class DummyContext:
            def __init__(self) -> None:
                self.metadata: dict[str, object] = {}
                self.instructions: list[tuple[str, str]] = []

            def extend_instructions(self, source_id: str, text: str) -> None:
                self.instructions.append((source_id, text))

        context = DummyContext()
        state: dict[str, object] = {}

        await provider.before_run(
            agent=object(),
            session=session,
            context=context,
            state=state,
        )

        snapshot = state["snapshot"]
        self.assertEqual(snapshot["session"]["session_id"], "ctx-7")
        self.assertEqual(snapshot["todos"]["total"], 1)
        self.assertEqual(context.metadata["current_info"], snapshot)
        self.assertIn("Current runtime context:", context.instructions[0][1])
