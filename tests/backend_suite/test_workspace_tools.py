"""Tests for workspace file tools and command helpers."""

from backend.agent.context import WorkspaceInfoProvider
from backend.agent.tools import (
    WORKSPACE_TOOLS,
    create_workspace_file,
    list_workspace_files,
    preview_workspace_file_tool_impl,
    read_workspace_file_tool_impl,
    run_workspace_python_tool_impl,
    run_workspace_shell_tool_impl,
    search_workspace_text_tool_impl,
    update_workspace_file,
)

from .support import AsyncBackendTestCase, BackendTestCase


class WorkspaceToolTests(BackendTestCase):
    def test_workspace_file_tools_round_trip(self) -> None:
        created = create_workspace_file("outputs/report.txt", "hello")
        updated = update_workspace_file("outputs/report.txt", "\nworld", mode="append")
        listed = list_workspace_files("outputs")
        read_back = read_workspace_file_tool_impl("outputs/report.txt")
        searched = search_workspace_text_tool_impl("world", "outputs")

        self.assertEqual(created["action"], "create")
        self.assertEqual(updated["action"], "append")
        self.assertEqual(read_back["text"], "hello\nworld")
        self.assertEqual(searched["matches"][0]["relative_path"], "outputs/report.txt")
        self.assertEqual(listed["entries"][0]["relative_path"], "outputs/report.txt")

    def test_workspace_tools_reject_path_escape(self) -> None:
        with self.assertRaises(ValueError):
            read_workspace_file_tool_impl("../outside.txt")

    def test_workspace_command_tools_run_in_workspace(self) -> None:
        shell_result = run_workspace_shell_tool_impl("Write-Output hello")
        python_result = run_workspace_python_tool_impl("print('workspace-python')")

        self.assertEqual(shell_result["exit_code"], 0)
        self.assertIn("hello", shell_result["stdout"])
        self.assertEqual(python_result["exit_code"], 0)
        self.assertIn("workspace-python", python_result["stdout"])

    def test_preview_workspace_file_returns_rich_preview_items(self) -> None:
        create_workspace_file("outputs/preview.txt", "hello preview world")
        create_workspace_file("outputs/sample.pdf", "%PDF-1.4 preview")

        text_preview = preview_workspace_file_tool_impl("outputs/preview.txt")
        pdf_preview = preview_workspace_file_tool_impl("outputs/sample.pdf")

        self.assertEqual(text_preview[0].type, "text")
        self.assertEqual(text_preview[1].type, "text")
        self.assertIn("hello preview world", text_preview[1].text)
        self.assertEqual(pdf_preview[1].type, "data")
        self.assertEqual(pdf_preview[1].media_type, "application/pdf")

    def test_workspace_tool_approval_modes(self) -> None:
        tool_modes = {tool.name: tool.approval_mode for tool in WORKSPACE_TOOLS}
        self.assertEqual(tool_modes["list_workspace_files"], "never_require")
        self.assertEqual(tool_modes["search_workspace_text"], "never_require")
        self.assertEqual(tool_modes["read_workspace_file"], "never_require")
        self.assertEqual(tool_modes["preview_workspace_file"], "never_require")
        self.assertEqual(tool_modes["create_workspace_file"], "always_require")
        self.assertEqual(tool_modes["update_workspace_file"], "always_require")
        self.assertEqual(tool_modes["run_workspace_shell"], "always_require")
        self.assertEqual(tool_modes["run_workspace_python"], "always_require")


class WorkspaceContextTests(AsyncBackendTestCase):
    async def test_workspace_provider_injects_snapshot(self) -> None:
        provider = WorkspaceInfoProvider()

        class DummyContext:
            def __init__(self) -> None:
                self.metadata = {}
                self.instructions = []

            def extend_instructions(self, source_id, text) -> None:
                self.instructions.append((source_id, text))

        context = DummyContext()
        session = type("Session", (), {"session_id": "ws-1", "state": {}})()
        state = {}

        await provider.before_run(agent=object(), session=session, context=context, state=state)

        self.assertIn("workspace_snapshot", state)
        self.assertIn("workspace_info", context.metadata)
        self.assertIn("Workspace context:", context.instructions[0][1])
