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
from ..services import (
    DOCUMENT_TEXT_MAX_CHARACTERS,
    build_file_reference_text,
    extract_document_text,
    guess_workspace_media_type,
    resolve_workspace_path,
)
from .context import CurrentInfoProvider, PlanningSnapshotProvider, WorkspaceInfoProvider
from .instructions import build_agent_instructions

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
        self._active_input_messages: list[Message] = []
        self._active_update_start = 0
        self._active_run_committed = True

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
        self._active_input_messages = _normalize_agent_input_messages(agent_input)
        self._active_update_start = len(self._updates)
        self._active_run_committed = False
        stream = self._agent.run(agent_input, stream=True, session=self._session)

        try:
            async for update in stream:
                self._updates.append(update)
                self._track_pending_approvals(update.user_input_requests)
                await _maybe_await(on_update(self._build_snapshot(status="running")))

            self._last_response = await stream.get_final_response()
            self._track_pending_approvals(self._last_response.user_input_requests)
            self._active_run_committed = True

            status = "needs_approval" if self._pending_approvals else "completed"
            snapshot = self._build_snapshot(status=status)
            if not snapshot["contents"] and status != "needs_approval":
                raise RuntimeError("The agent returned an empty reply.")
            return snapshot
        finally:
            if self._active_run_committed:
                self._active_input_messages = []

    def handle_disconnect(self) -> None:
        self._persist_interrupted_history()
        self._pending_approvals.clear()
        pending_requests = getattr(self._agent, "pending_requests", None)
        if isinstance(pending_requests, dict):
            pending_requests.clear()

    def _track_pending_approvals(self, requests: Sequence[Content]) -> None:
        for request in requests:
            if request.type == "function_approval_request" and request.id:
                self._pending_approvals[request.id] = request

    def _persist_interrupted_history(self) -> None:
        if self._active_run_committed:
            return

        history_state = self._session.state.setdefault("memory", {})
        existing_messages = list(history_state.get("messages", []))
        partial_messages = self._build_interrupted_history_messages()
        if not self._active_input_messages and not partial_messages:
            return

        history_state["messages"] = [*existing_messages, *self._active_input_messages, *partial_messages]
        self._active_run_committed = True
        self._active_input_messages = []

    def _build_interrupted_history_messages(self) -> list[Message]:
        response = self._build_active_response()
        messages = list(response.messages)
        interruption_note = Content.from_text("[Run interrupted by user before completion.]")

        if messages:
            messages[-1].contents.append(interruption_note)
            return messages

        return [Message("assistant", [interruption_note])]

    def _build_active_response(self) -> AgentResponse[Any]:
        active_updates = self._updates[self._active_update_start :]
        if active_updates:
            return AgentResponse.from_updates(active_updates)
        return AgentResponse(messages=[])

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

    def _uses_xiaomi_compatibility(self) -> bool:
        return _should_register_hosted_web_search_tool(
            str(self.base_url) if self.base_url is not None else None
        )

    def _prepare_tools_for_openai(self, tools: Any) -> dict[str, Any]:
        prepared = super()._prepare_tools_for_openai(tools)
        if self._uses_xiaomi_compatibility():
            web_search_options = prepared.pop("web_search_options", None)
            if web_search_options is not None:
                tool_list = list(prepared.get("tools") or [])
                tool_list.append({"type": "web_search", **web_search_options})
                prepared["tools"] = tool_list
        return prepared

    def _prepare_message_for_openai(self, message: Message) -> list[dict[str, Any]]:
        prepared_messages = super()._prepare_message_for_openai(message)
        if not self._uses_xiaomi_compatibility():
            return prepared_messages

        for prepared in prepared_messages:
            if "reasoning_details" not in prepared:
                continue
            reasoning_details = prepared.pop("reasoning_details")
            reasoning_content = _coerce_reasoning_content(reasoning_details)
            if reasoning_content:
                prepared["reasoning_content"] = reasoning_content
        return prepared_messages

    def _parse_response_update_from_openai(self, chunk: Any) -> Any:
        parsed = super()._parse_response_update_from_openai(chunk)
        if self._uses_xiaomi_compatibility():
            for choice in chunk.choices:
                reasoning_content = _extract_reasoning_content(getattr(choice, "delta", None))
                if reasoning_content:
                    parsed.contents.append(
                        Content.from_text_reasoning(
                            protected_data=json.dumps(
                                {"reasoning_content": reasoning_content},
                                ensure_ascii=False,
                            )
                        )
                    )
        return parsed


def _normalize_base_url(base_url: str | None) -> str:
    if not isinstance(base_url, str):
        return ""
    return base_url.strip().lower()


def _should_register_hosted_web_search_tool(base_url: str | None) -> bool:
    normalized = _normalize_base_url(base_url)
    return any(token in normalized for token in XIAOMI_WEB_SEARCH_HOST_TOKENS)


def _extract_reasoning_content(value: Any) -> Any:
    if value is None:
        return None

    reasoning_content = getattr(value, "reasoning_content", None)
    if reasoning_content:
        return reasoning_content

    if isinstance(value, Mapping):
        return value.get("reasoning_content")

    for extra_name in ("model_extra", "__pydantic_extra__"):
        extra = getattr(value, extra_name, None)
        if isinstance(extra, Mapping) and extra.get("reasoning_content"):
            return extra["reasoning_content"]

    return None


def _coerce_reasoning_content(reasoning_details: Any) -> str | None:
    if isinstance(reasoning_details, Mapping) and "reasoning_content" in reasoning_details:
        reasoning_details = reasoning_details["reasoning_content"]

    if reasoning_details is None:
        return None

    if isinstance(reasoning_details, str):
        return reasoning_details

    return json.dumps(reasoning_details, ensure_ascii=False)


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
            tuple[str | None, str | None, str | None, str | None, str | None] | None
        ) = None
        self._session: AgentSession | None = None

    def get_agent(self) -> Any:
        config = get_config()
        api_key = config["openaiApiKey"]
        model = config["openaiChatModel"]
        endpoint = config["openaiEndpoint"]
        motd_language = config.get("motdLanguage")
        workspace_path = config.get("workspacePath")

        next_config = (api_key, model, endpoint, motd_language, workspace_path)
        if self._agent is None or self._agent_config != next_config:
            tools = _build_agent_tools(endpoint)
            self._agent = _build_chat_completion_client(
                model=model,
                api_key=api_key,
                endpoint=endpoint,
            ).as_agent(
                instructions=build_agent_instructions(motd_language),
                tools=tools,
                default_options={"tool_choice": "auto"},
                context_providers=[
                    InMemoryHistoryProvider("memory", load_messages=True),
                    CurrentInfoProvider(),
                    PlanningSnapshotProvider(),
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
                        capability=str(item.get("capability") or "image_native"),
                        readability=str(item.get("readability") or "llm_native"),
                        inline_note="The image bytes are attached inline for multimodal inspection.",
                    )
                )
            )
            continue

        if part_type == "file":
            name = str(item.get("name") or "file")
            media_type = str(item.get("mediaType") or "application/octet-stream")
            relative_path = str(item.get("relativePath") or "")
            capability = str(item.get("capability") or "").strip() or None
            readability = str(item.get("readability") or "").strip() or None
            message = str(item.get("message") or "").strip() or None
            summary_text = str(item.get("summaryText") or "") or None
            extracted_text = None
            if capability == "document_extractable":
                extracted_text = _extract_attached_document_text(relative_path, media_type)
            elif capability == "text_inline" and summary_text:
                extracted_text = summary_text

            user_contents.append(
                Content.from_text(
                    build_file_reference_text(
                        name=name,
                        media_type=media_type,
                        size_bytes=int(item.get("sizeBytes") or 0),
                        relative_path=relative_path,
                        capability=capability,
                        readability=readability,
                        summary_text=extracted_text,
                        message=message or _default_attachment_message(capability),
                    )
                )
            )
            continue

        raise ValueError(f"Unsupported input content type: {part_type}")

    return Message("user", user_contents)


def _extract_attached_document_text(relative_path: str, media_type: str) -> str | None:
    try:
        file_path = resolve_workspace_path(relative_path)
        extraction = extract_document_text(
            file_path,
            media_type=media_type or guess_workspace_media_type(relative_path),
            max_characters=DOCUMENT_TEXT_MAX_CHARACTERS,
        )
    except Exception as exc:
        return f"Document text extraction failed: {type(exc).__name__}: {exc}. Do not infer this document's contents."

    if not extraction.readable:
        return f"{extraction.message} Do not infer this document's contents."

    header = [
        "Extracted document text:",
        f"- Extraction Status: {extraction.message}",
        f"- Truncated: {extraction.truncated}",
    ]
    if extraction.page_or_sheet_count is not None:
        header.append(f"- Pages/Sheets/Slides: {extraction.page_or_sheet_count}")
    if extraction.warnings:
        header.append("- Warnings: " + "; ".join(extraction.warnings))
    return "\n".join(header) + "\n\n" + extraction.text


def _default_attachment_message(capability: str | None) -> str | None:
    if capability == "image_native":
        return "Image was not provided inline to the model. Do not infer visual details unless an image preview tool succeeds."
    if capability == "unsupported_temporal":
        return "Audio and video files are not supported. Do not infer their contents."
    if capability == "unsupported_binary":
        return "This file type is not directly readable. Do not infer its contents."
    return None


def _normalize_agent_input_messages(agent_input: Content | Message) -> list[Message]:
    if isinstance(agent_input, Message):
        return [agent_input]
    return [Message("user", [agent_input])]


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
