"""Runtime tests for structured agent message handling."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from agent_framework import AgentResponse, AgentResponseUpdate, Content, Message

from backend.agent.runtime import (
    AdaptiveChatCompletionClient,
    AgentRunController,
    AgentRuntime,
    _build_agent_tools,
    _build_user_message,
    _serialize_content,
)

from .support import AsyncBackendTestCase, BackendTestCase


class FakeStream:
    def __init__(self, updates, final_response) -> None:
        self._updates = list(updates)
        self._final_response = final_response
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._updates):
            raise StopAsyncIteration
        update = self._updates[self._index]
        self._index += 1
        return update

    async def get_final_response(self):
        return self._final_response


class FakeAgent:
    def __init__(self) -> None:
        self.calls = []
        self.approval_request = Content.from_function_approval_request(
            id="approval-1",
            function_call=Content.from_function_call(
                call_id="call-1",
                name="create_todo",
                arguments='{"title":"Ship report"}',
            ),
        )

    def run(self, agent_input, stream, session):
        self.calls.append(agent_input)
        if len(self.calls) == 1:
            update = AgentResponseUpdate(
                role="assistant",
                contents=[self.approval_request.function_call, self.approval_request],
            )
            response = AgentResponse(
                messages=[Message("assistant", [self.approval_request.function_call, self.approval_request])]
            )
            return FakeStream([update], response)

        update = AgentResponseUpdate(
            role="assistant",
            contents=[Content.from_text("Done.")],
        )
        response = AgentResponse(messages=[Message("assistant", [Content.from_text("Done.")])])
        return FakeStream([update], response)


class AgentRuntimeTests(AsyncBackendTestCase):
    async def test_build_user_message_supports_text_image_and_workspace_file(self) -> None:
        message = _build_user_message(
            [
                {"type": "text", "text": "Summarize this"},
                {
                    "type": "image",
                    "name": "photo.png",
                    "mediaType": "image/png",
                    "sizeBytes": 3,
                    "relativePath": "inputs/req-1/01-photo.png",
                    "dataBase64": "YWJj",
                },
                {
                    "type": "file",
                    "name": "notes.md",
                    "mediaType": "text/markdown",
                    "sizeBytes": 7,
                    "relativePath": "inputs/req-1/02-notes.md",
                    "summaryText": "# Notes",
                },
            ]
        )

        self.assertEqual(message.role, "user")
        self.assertEqual(message.contents[0].type, "text")
        self.assertEqual(message.contents[1].type, "data")
        self.assertEqual(message.contents[1].media_type, "image/png")
        self.assertIn("data:image/png;base64,YWJj", message.contents[1].uri)
        self.assertIn("Workspace Path: inputs/req-1/01-photo.png", message.contents[2].text)
        self.assertIn("Preview:", message.contents[3].text)

    async def test_serialize_content_supports_tool_requests_results_images_and_files(self) -> None:
        image_content = Content.from_uri(
            uri="data:image/png;base64,YWJj",
            media_type="image/png",
            additional_properties={"name": "preview.png", "relativePath": "outputs/preview.png", "sizeBytes": 3},
        )
        file_content = Content.from_hosted_file(
            file_id="file-123",
            media_type="text/plain",
            name="summary.txt",
        )
        function_result = Content.from_function_result(
            call_id="call-1",
            result=[Content.from_text("Saved."), image_content, file_content],
        )
        approval_request = Content.from_function_approval_request(
            id="approval-1",
            function_call=Content.from_function_call(
                call_id="call-1",
                name="create_todo",
                arguments='{"title":"Ship report"}',
            ),
        )

        serialized_result = _serialize_content(function_result, {"approval-1": "approved"})
        serialized_request = _serialize_content(approval_request, {"approval-1": "approved"})

        self.assertEqual(serialized_result["type"], "function_result")
        self.assertEqual(serialized_result["items"][1]["type"], "image")
        self.assertEqual(serialized_result["items"][1]["relativePath"], "outputs/preview.png")
        self.assertEqual(serialized_result["items"][2]["type"], "file")
        self.assertEqual(serialized_request["type"], "function_approval_request")
        self.assertEqual(serialized_request["decision"], "approved")

    async def test_agent_run_controller_resumes_after_approval(self) -> None:
        updates = []
        controller = AgentRunController(FakeAgent(), session=object())

        first_message = await controller.start(
            [{"type": "text", "text": "Create a todo"}],
            lambda message: updates.append(message),
        )

        self.assertEqual(first_message["status"], "needs_approval")
        self.assertEqual(first_message["contents"][1]["type"], "function_approval_request")
        self.assertEqual(updates[-1]["status"], "running")

        final_message = await controller.respond_to_approval(
            "approval-1",
            True,
            lambda message: updates.append(message),
        )

        self.assertEqual(final_message["status"], "completed")
        self.assertEqual(final_message["contents"][1]["decision"], "approved")
        self.assertEqual(final_message["contents"][-1]["type"], "text")
        self.assertEqual(final_message["contents"][-1]["text"], "Done.")


class AdaptiveClientTests(BackendTestCase):
    def test_adaptive_chat_completion_client_rewrites_web_search_for_xiaomi(self) -> None:
        client = AdaptiveChatCompletionClient(
            model="demo-model",
            api_key="demo-key",
            base_url="https://token-plan-cn.xiaomimimo.com/v1",
        )

        prepared = client._prepare_tools_for_openai(
            [
                AdaptiveChatCompletionClient.get_web_search_tool(
                    web_search_options={"search_context_size": "medium"}
                )
            ]
        )

        self.assertNotIn("web_search_options", prepared)
        self.assertEqual(
            prepared["tools"],
            [{"type": "web_search", "search_context_size": "medium"}],
        )

    def test_adaptive_chat_completion_client_keeps_standard_web_search_shape_elsewhere(self) -> None:
        client = AdaptiveChatCompletionClient(
            model="demo-model",
            api_key="demo-key",
            base_url="https://api.openai.com/v1",
        )

        prepared = client._prepare_tools_for_openai(
            [
                AdaptiveChatCompletionClient.get_web_search_tool(
                    web_search_options={"search_context_size": "medium"}
                )
            ]
        )

        self.assertEqual(prepared["web_search_options"], {"search_context_size": "medium"})
        self.assertIsNone(prepared.get("tools"))

    def test_build_agent_tools_only_adds_hosted_web_search_for_supported_endpoint(self) -> None:
        xiaomi_tools = _build_agent_tools("https://token-plan-cn.xiaomimimo.com/v1")
        default_tools = _build_agent_tools(None)

        self.assertTrue(any(isinstance(tool, dict) and tool.get("type") == "web_search" for tool in xiaomi_tools))
        self.assertFalse(any(isinstance(tool, dict) and tool.get("type") == "web_search" for tool in default_tools))

    def test_agent_runtime_uses_adaptive_client_in_main_workflow(self) -> None:
        from backend.config import get_config, set_config

        set_config(
            {
                **get_config(),
                "openaiApiKey": "demo-key",
                "openaiChatModel": "demo-model",
                "openaiEndpoint": "https://token-plan-cn.xiaomimimo.com/v1",
            }
        )
        fake_agent = SimpleNamespace(create_session=lambda: "session-1")
        runtime = AgentRuntime()

        with patch(
            "backend.agent.runtime.AdaptiveChatCompletionClient.as_agent",
            return_value=fake_agent,
        ) as as_agent:
            agent = runtime.get_agent()

        self.assertIs(agent, fake_agent)
        tools = as_agent.call_args.kwargs["tools"]
        self.assertTrue(any(isinstance(tool, dict) and tool.get("type") == "web_search" for tool in tools))
