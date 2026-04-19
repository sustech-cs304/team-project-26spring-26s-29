"""Agent runtime lifecycle and structured streaming helpers."""

from __future__ import annotations

import json
import mimetypes
from collections.abc import Awaitable, Callable, Mapping, Sequence
from inspect import isawaitable
from typing import Any

from agent_framework import (
    AgentResponse,
    AgentResponseUpdate,
    AgentSession,
    Content,
    InMemoryHistoryProvider,
    Message,
)
from agent_framework.openai import OpenAIChatCompletionClient

from ..config import get_config
from ..services import build_file_reference_text
from .context import CurrentInfoProvider, WorkspaceInfoProvider
from .instructions import AGENT_INSTRUCTIONS

from .tools import SCHEDULE_TOOLS, TODO_TOOLS, WORKSPACE_TOOLS


MessageSnapshot = dict[str, Any]
InputPart = Mapping[str, Any]
XIAOMI_WEB_SEARCH_HOST_TOKENS = ("xiaomimimo",)


class AgentRunController:
    """Runs one structured agent exchange and can resume pending approvals."""

    def __init__(self, agent: Any, session: AgentSession) -> None:
        self._agent = agent
        self._session = session
        self._updates: list[AgentResponseUpdate] = []
        self._last_response: AgentResponse[Any] | None = None
        self._pending_approvals: dict[str, Content] = {}
        self._approval_decisions: dict[str, str] = {}

    async def start(
        self,
        contents: Sequence[InputPart],
        on_update: Callable[[MessageSnapshot], Awaitable[None] | None],
    ) -> MessageSnapshot:
        return await self._run_with_input(_build_user_message(contents), on_update)

    async def respond_to_approval(
        self,
        approval_id: str,
        approved: bool,
        on_update: Callable[[MessageSnapshot], Awaitable[None] | None],
    ) -> MessageSnapshot:
        request = self._pending_approvals.pop(approval_id, None)
        if request is None:
            raise ValueError(f"Unknown approval request: {approval_id}")

        self._approval_decisions[approval_id] = "approved" if approved else "rejected"
        response = request.to_function_approval_response(approved=approved)
        return await self._run_with_input(response, on_update)

    async def _run_with_input(
        self,
        agent_input: Content | Message,
        on_update: Callable[[MessageSnapshot], Awaitable[None] | None],
    ) -> MessageSnapshot:
        stream = self._agent.run(agent_input, stream=True, session=self._session)

        async for update in stream:
            self._updates.append(update)
            self._track_pending_approvals(update.user_input_requests)
            await _maybe_await(on_update(self._build_snapshot(status="running")))

        self._last_response = await stream.get_final_response()
        self._track_pending_approvals(self._last_response.user_input_requests)

        status = "needs_approval" if self._pending_approvals else "completed"
        snapshot = self._build_snapshot(status=status)
        if not snapshot["contents"] and status != "needs_approval":
            raise RuntimeError("The agent returned an empty reply.")
        return snapshot

    def _track_pending_approvals(self, requests: Sequence[Content]) -> None:
        for request in requests:
            if request.type == "function_approval_request" and request.id:
                self._pending_approvals[request.id] = request

    def _build_snapshot(self, *, status: str) -> MessageSnapshot:
        response = self._build_response()
        contents: list[dict[str, Any]] = []
        for message in response.messages:
            for content in message.contents:
                serialized = _serialize_content(content, self._approval_decisions)
                if serialized is not None:
                    contents.append(serialized)
        return {
            "role": "assistant",
            "status": status,
            "contents": _dedupe_message_contents(contents),
        }

    def _build_response(self) -> AgentResponse[Any]:
        if self._updates:
            return AgentResponse.from_updates(self._updates)
        if self._last_response is not None:
            return self._last_response
        return AgentResponse(messages=[])


class AdaptiveChatCompletionClient(OpenAIChatCompletionClient):
    """Adapt Xiaomi's hosted web_search tool inside the tools array."""

    def _prepare_tools_for_openai(self, tools: Any) -> dict[str, Any]:
        prepared = super()._prepare_tools_for_openai(tools)
        if _should_register_hosted_web_search_tool(
            str(self.base_url) if self.base_url is not None else None
        ):
            web_search_options = prepared.pop("web_search_options", None)
            if web_search_options is not None:
                tool_list = list(prepared.get("tools") or [])
                tool_list.append({"type": "web_search", **web_search_options})
                prepared["tools"] = tool_list
        return prepared


def _normalize_base_url(base_url: str | None) -> str:
    if not isinstance(base_url, str):
        return ""
    return base_url.strip().lower()


def _should_register_hosted_web_search_tool(base_url: str | None) -> bool:
    normalized = _normalize_base_url(base_url)
    return any(token in normalized for token in XIAOMI_WEB_SEARCH_HOST_TOKENS)


def _build_agent_tools(base_url: str | None) -> list[Any]:
    tools: list[Any] = [*TODO_TOOLS, *WORKSPACE_TOOLS, *SCHEDULE_TOOLS]
    if _should_register_hosted_web_search_tool(base_url):
        tools.append(AdaptiveChatCompletionClient.get_web_search_tool())
    return tools


def _build_chat_completion_client(
    *,
    model: str | None,
    api_key: str | None,
    endpoint: str | None,
) -> AdaptiveChatCompletionClient:
    return AdaptiveChatCompletionClient(
        model=model,
        api_key=api_key or "unused",
        base_url=endpoint or None,
    )


class AgentRuntime:
    """Owns agent client creation, session reuse, and run-controller creation."""

    def __init__(self) -> None:
        self._agent: Any | None = None
        self._agent_config: (
            tuple[str | None, str | None, str | None, str | None] | None
        ) = None
        self._session: AgentSession | None = None

    def get_agent(self) -> Any:
        config = get_config()
        api_key = config["openaiApiKey"]
        model = config["openaiChatModel"]
        endpoint = config["openaiEndpoint"]
        workspace_path = config.get("workspacePath")

        next_config = (api_key, model, endpoint, workspace_path)
        if self._agent is None or self._agent_config != next_config:
            tools = _build_agent_tools(endpoint)
            self._agent = _build_chat_completion_client(
                model=model,
                api_key=api_key,
                endpoint=endpoint,
            ).as_agent(
                instructions=AGENT_INSTRUCTIONS,
                tools=tools,
                default_options={"tool_choice": "auto"},
                context_providers=[
                    InMemoryHistoryProvider("memory", load_messages=True),
                    CurrentInfoProvider(),
                    WorkspaceInfoProvider(),
                ],
            )
            self._agent_config = next_config
            self._session = self._agent.create_session()

        return self._agent

    def get_session(self) -> AgentSession:
        self.get_agent()
        if self._session is None:
            raise RuntimeError("Agent session is not initialized.")
        return self._session

    def create_run(self) -> AgentRunController:
        return AgentRunController(self.get_agent(), self.get_session())

    async def run_prompt(self, contents: Sequence[InputPart]) -> MessageSnapshot:
        controller = self.create_run()
        return await controller.start(contents, lambda _snapshot: None)


def _build_user_message(contents: Sequence[InputPart]) -> Message:
    user_contents: list[Content] = []
    for item in contents:
        part_type = str(item.get("type") or "").strip()
        if part_type == "text":
            user_contents.append(Content.from_text(str(item.get("text") or "")))
            continue

        if part_type == "image":
            media_type = str(item.get("mediaType") or "image/png")
            encoded = str(item.get("dataBase64") or "")
            relative_path = str(item.get("relativePath") or "")
            name = str(item.get("name") or "image")
            user_contents.append(
                Content.from_uri(
                    uri=f"data:{media_type};base64,{encoded}",
                    media_type=media_type,
                    additional_properties={"name": name, "relativePath": relative_path},
                )
            )
            user_contents.append(
                Content.from_text(
                    build_file_reference_text(
                        name=name,
                        media_type=media_type,
                        size_bytes=int(item.get("sizeBytes") or 0),
                        relative_path=relative_path,
                        inline_note="The image bytes are attached inline for multimodal inspection.",
                    )
                )
            )
            continue

        if part_type == "file":
            name = str(item.get("name") or "file")
            media_type = str(item.get("mediaType") or "application/octet-stream")
            summary_text = str(item.get("summaryText") or "") or None
            user_contents.append(
                Content.from_text(
                    build_file_reference_text(
                        name=name,
                        media_type=media_type,
                        size_bytes=int(item.get("sizeBytes") or 0),
                        relative_path=str(item.get("relativePath") or ""),
                        summary_text=summary_text,
                    )
                )
            )
            continue

        raise ValueError(f"Unsupported input content type: {part_type}")

    return Message("user", user_contents)


def _serialize_content(
    content: Content,
    approval_decisions: Mapping[str, str],
) -> dict[str, Any] | None:
    if content.type == "text_reasoning" or content.type == "function_approval_response":
        return None

    if content.type == "text":
        return {
            "type": "text",
            "text": content.text or "",
        }

    if content.type == "error":
        return {
            "type": "error",
            "message": content.message or "",
            "errorCode": content.error_code,
            "details": content.error_details,
        }

    if content.type == "function_call":
        parsed_arguments = content.parse_arguments()
        return {
            "type": "function_call",
            "callId": content.call_id,
            "name": content.name,
            "arguments": parsed_arguments,
            "argumentsText": _stringify_arguments(parsed_arguments),
            "exception": content.exception,
        }

    if content.type == "function_result":
        return {
            "type": "function_result",
            "callId": content.call_id,
            "result": content.result or "",
            "exception": content.exception,
            "items": [
                item
                for item in (
                    _serialize_content(item, approval_decisions)
                    for item in (content.items or [])
                )
                if item is not None
            ],
        }

    if content.type == "function_approval_request":
        return {
            "type": "function_approval_request",
            "approvalId": content.id,
            "decision": approval_decisions.get(content.id, "pending"),
            "functionCall": (
                _serialize_content(content.function_call, approval_decisions)
                if content.function_call is not None
                else None
            ),
        }

    if content.type in {"data", "uri"} and _content_is_image(content):
        return _serialize_binary_content(content, part_type="image")

    if content.type in {"data", "uri", "hosted_file"}:
        return _serialize_binary_content(content, part_type="file")

    return {
        "type": "json",
        "label": content.type,
        "data": content.to_dict(exclude_none=True),
    }


def _serialize_binary_content(content: Content, *, part_type: str) -> dict[str, Any]:
    name = _resolve_content_name(content, part_type)
    additional_properties = content.additional_properties or {}
    payload = {
        "type": part_type,
        "name": name,
        "mediaType": content.media_type,
        "uri": getattr(content, "uri", None),
        "dataBase64": _extract_base64_from_data_uri(getattr(content, "uri", None)),
        "fileId": getattr(content, "file_id", None),
        "relativePath": additional_properties.get("relativePath"),
        "sizeBytes": additional_properties.get("sizeBytes"),
        "summaryText": additional_properties.get("summaryText"),
    }
    return payload


def _dedupe_message_contents(
    contents: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for item in contents:
        marker = json.dumps(item, ensure_ascii=False, sort_keys=True, default=str)
        if marker in seen:
            continue
        seen.add(marker)
        deduped.append(item)
    return deduped


def _resolve_content_name(content: Content, fallback_stem: str) -> str:
    additional_properties = content.additional_properties or {}
    name = getattr(content, "name", None) or additional_properties.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    file_id = getattr(content, "file_id", None)
    if isinstance(file_id, str) and file_id:
        extension = _guess_extension(content.media_type)
        return f"{fallback_stem}-{file_id}{extension}"

    extension = _guess_extension(content.media_type)
    return f"{fallback_stem}{extension}"


def _guess_extension(media_type: str | None) -> str:
    if not media_type:
        return ""
    return mimetypes.guess_extension(media_type) or ""


def _extract_base64_from_data_uri(uri: str | None) -> str | None:
    if not isinstance(uri, str) or not uri.startswith("data:"):
        return None
    return uri.split(",", 1)[-1]


def _content_is_image(content: Content) -> bool:
    try:
        return content.has_top_level_media_type("image")
    except Exception:
        return False


def _stringify_arguments(arguments: Any) -> str:
    if arguments is None:
        return ""
    if isinstance(arguments, dict) and set(arguments) == {"raw"}:
        return str(arguments["raw"])
    try:
        return json.dumps(arguments, ensure_ascii=False, indent=2)
    except TypeError:
        return str(arguments)


async def _maybe_await(value: Awaitable[None] | None) -> None:
    if isawaitable(value):
        await value


agent_runtime = AgentRuntime()


def get_agent() -> Any:
    return agent_runtime.get_agent()


def get_session() -> AgentSession:
    return agent_runtime.get_session()


def create_run() -> AgentRunController:
    return agent_runtime.create_run()


async def run_prompt(contents: Sequence[InputPart]) -> MessageSnapshot:
    return await agent_runtime.run_prompt(contents)
