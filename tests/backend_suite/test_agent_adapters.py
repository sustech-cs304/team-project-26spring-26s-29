"""Tests for agent-facing tool and context adapters."""

from types import SimpleNamespace

from backend.agent.context import CurrentInfoProvider
from backend.agent.tools import TODO_TOOLS, manage_todo_list

from .support import AsyncBackendTestCase, BackendTestCase


class AgentToolTests(BackendTestCase):
    def test_manage_todo_list_tool_round_trip(self) -> None:
        created = manage_todo_list(action="create", title="Call teammate", detail="sync on PR")
        listed = manage_todo_list(action="list")
        updated = manage_todo_list(action="update", todo_id=created["todo"]["id"], is_done=True)
        deleted = manage_todo_list(action="delete", todo_id=created["todo"]["id"])

        self.assertEqual(len(TODO_TOOLS), 1)
        self.assertEqual(created["action"], "create")
        self.assertEqual(listed["count"], 1)
        self.assertTrue(updated["todo"]["is_done"])
        self.assertTrue(deleted["deleted"])


class AgentContextTests(AsyncBackendTestCase):
    async def test_current_info_provider_injects_snapshot(self) -> None:
        manage_todo_list(action="create", title="Review commit", detail="")
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
