"""Tests for agent-facing tool and context adapters."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from backend.agent.context import CurrentInfoProvider, PlanningSnapshotProvider
from backend.agent.instructions import (
    AGENT_INSTRUCTIONS,
    MOTD_TRIGGER_PROMPT,
    build_agent_instructions,
)
from backend.agent.tools import (
    SCHEDULE_TOOLS,
    TODO_TOOLS,
    create_todo,
    delete_todo,
    list_todos,
    update_todo,
)
from backend.services import schedule_service, todo_service

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

    def test_todo_tool_descriptions_warn_against_internal_planning(self) -> None:
        for tool in TODO_TOOLS:
            self.assertIn("Never use it to track the assistant's own plan", tool.description)

    def test_schedule_and_todo_tool_descriptions_define_their_boundary(self) -> None:
        self.assertIn("homework, assignments, projects", SCHEDULE_TOOLS[0].description)
        self.assertIn("remind me tomorrow about my exam", SCHEDULE_TOOLS[0].description)
        self.assertIn("those belong in schedule", TODO_TOOLS[0].description)
        self.assertIn("short-term AI-executed work", TODO_TOOLS[0].description)

    def test_agent_instructions_define_schedule_todo_split(self) -> None:
        self.assertIn("schedule stores real-world events the user must attend on time", AGENT_INSTRUCTIONS)
        self.assertIn("todo stores tasks the user only needs to finish before a deadline", AGENT_INSTRUCTIONS)
        self.assertIn("remind me tomorrow about my exam", AGENT_INSTRUCTIONS)
        self.assertIn("Do not add the assistant's own short-term work", AGENT_INSTRUCTIONS)

    def test_agent_instructions_require_brief_save_confirmations(self) -> None:
        self.assertIn("reply very briefly after the tool call", AGENT_INSTRUCTIONS)
        self.assertIn("do not add extra study tips", AGENT_INSTRUCTIONS)
        self.assertIn("I saved it for you. Remember to finish it on time.", AGENT_INSTRUCTIONS)
        self.assertIn("Mention a schedule id or todo id only when it is helpful", AGENT_INSTRUCTIONS)

    def test_agent_instructions_define_localized_startup_motd(self) -> None:
        english_instructions = build_agent_instructions("en")
        chinese_instructions = build_agent_instructions("zh-CN")

        self.assertIn(MOTD_TRIGGER_PROMPT, AGENT_INSTRUCTIONS)
        self.assertIn("当前时间：<当前本地时间>", AGENT_INSTRUCTIONS)
        self.assertIn("Reply with a MOTD in English.", english_instructions)
        self.assertIn("Nearest schedule: <nearest schedule or none>", english_instructions)
        self.assertIn("The selected MOTD language is locked to English.", english_instructions)
        self.assertIn('do not output Chinese words or phrases such as "今天", "下午", "加油", or "暂无"', english_instructions)
        self.assertIn('render it in English style such as "3:00 PM"', english_instructions)
        self.assertIn("本次 MOTD 的输出语言锁定为简体中文。", chinese_instructions)
        self.assertIn("For normal user requests, do not apply the MOTD format", english_instructions)


class AgentContextTests(AsyncBackendTestCase):
    async def test_current_info_provider_injects_snapshot(self) -> None:
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

        with patch(
            "backend.agent.context.current_info._fetch_public_ip_info",
            return_value={
                "provider": "ipinfo.io",
                "available": True,
                "ip": "203.0.113.24",
                "city": "Hong Kong",
                "region": "Hong Kong",
                "country": "HK",
                "loc": "22.3193,114.1694",
                "org": "Example ISP",
                "postal": "",
                "timezone": "Asia/Hong_Kong",
            },
        ):
            await provider.before_run(
                agent=object(),
                session=session,
                context=context,
                state=state,
            )

        snapshot = state["snapshot"]
        self.assertEqual(snapshot["session"]["session_id"], "ctx-7")
        self.assertEqual(snapshot["network"]["ip"], "203.0.113.24")
        self.assertEqual(snapshot["network"]["provider"], "ipinfo.io")
        self.assertIn("python", snapshot["system"])
        self.assertEqual(context.metadata["current_info"], snapshot)
        self.assertIn("Current runtime context:", context.instructions[0][1])
        self.assertIn("Runtime:", context.instructions[0][1])
        self.assertIn("Public IP: 203.0.113.24", context.instructions[0][1])

    async def test_planning_snapshot_provider_injects_nearest_schedule_and_todo(self) -> None:
        provider = PlanningSnapshotProvider()
        session = SimpleNamespace(session_id="ctx-8", state={})

        class DummyContext:
            def __init__(self) -> None:
                self.metadata: dict[str, object] = {}
                self.instructions: list[tuple[str, str]] = []

            def extend_instructions(self, source_id: str, text: str) -> None:
                self.instructions.append((source_id, text))

        schedule_service.create_schedule(
            title="Algorithms Lecture",
            detail="Room 101",
            start_at="2026-04-20T09:00:00+00:00",
            end_at="2026-04-20T10:30:00+00:00",
        )
        todo_service.create_todo(
            title="Submit lab",
            detail="Before noon",
            due_at="2026-04-20T11:00:00+00:00",
        )

        context = DummyContext()
        state: dict[str, object] = {}

        with patch(
            "backend.agent.context.planning_snapshot._now_local",
            return_value=datetime(2026, 4, 20, 8, 30, tzinfo=timezone.utc),
        ):
            await provider.before_run(
                agent=object(),
                session=session,
                context=context,
                state=state,
            )

        snapshot = state["planning_snapshot"]
        self.assertEqual(snapshot["schedule_total"], 1)
        self.assertEqual(snapshot["todo_total"], 1)
        self.assertEqual(snapshot["nearest_schedule"]["title"], "Algorithms Lecture")
        self.assertEqual(snapshot["nearest_todo"]["title"], "Submit lab")
        self.assertEqual(context.metadata["planning_snapshot"], snapshot)
        self.assertIn("Planning snapshot for schedule/todo-aware replies:", context.instructions[0][1])
        self.assertIn("Algorithms Lecture", context.instructions[0][1])
        self.assertIn("Submit lab", context.instructions[0][1])
