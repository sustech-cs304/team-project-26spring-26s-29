"""MiMo-specific OpenAI-compatible client adjustments."""

from __future__ import annotations

from collections.abc import Awaitable, Mapping, MutableMapping, Sequence
from typing import Any, cast

from agent_framework import ResponseStream
from agent_framework._tools import FunctionTool, normalize_tools
from agent_framework.exceptions import ChatClientException
from agent_framework.openai import OpenAIChatCompletionClient


class MiMoChatCompletionClient(OpenAIChatCompletionClient):
    """OpenAI-compatible client with MiMo-native web_search pass-through and fallback retry."""

    def _prepare_tools_for_openai(
        self,
        tools: Any,
    ) -> dict[str, Any]:
        chat_tools: list[Any] = []
        for item in normalize_tools(tools):
            if isinstance(item, FunctionTool):
                chat_tools.append(item.to_json_schema_spec())
            elif isinstance(item, MutableMapping):
                chat_tools.append(dict(item))
            else:
                chat_tools.append(item)
        return {"tools": chat_tools} if chat_tools else {}

    def _inner_get_response(
        self,
        *,
        messages: Sequence[Any],
        options: Mapping[str, Any],
        stream: bool = False,
        **kwargs: Any,
    ) -> Any:
        fallback_options = _options_without_web_search(options)

        if stream:
            final_response: Any | None = None

            async def _stream() -> Any:
                nonlocal final_response
                current_options: Mapping[str, Any] = options
                attempted_fallback = False

                while True:
                    yielded_any = False
                    inner_stream = cast(
                        ResponseStream[Any, Any],
                        super(MiMoChatCompletionClient, self)._inner_get_response(
                            messages=messages,
                            options=current_options,
                            stream=True,
                            **kwargs,
                        ),
                    )
                    try:
                        async for update in inner_stream:
                            yielded_any = True
                            yield update
                        final_response = await inner_stream.get_final_response()
                        return
                    except Exception as exc:
                        if (
                            not attempted_fallback
                            and not yielded_any
                            and fallback_options is not None
                            and _should_retry_without_web_search(exc)
                        ):
                            attempted_fallback = True
                            current_options = fallback_options
                            continue
                        raise

            async def _finalize(_updates: Sequence[Any]) -> Any:
                if final_response is None:
                    raise RuntimeError("MiMo streaming response completed without a final response.")
                return final_response

            return ResponseStream(_stream(), finalizer=_finalize)

        async def _get() -> Any:
            try:
                return await cast(
                    Awaitable[Any],
                    super(MiMoChatCompletionClient, self)._inner_get_response(
                        messages=messages,
                        options=options,
                        stream=False,
                        **kwargs,
                    ),
                )
            except Exception as exc:
                if fallback_options is not None and _should_retry_without_web_search(exc):
                    return await cast(
                        Awaitable[Any],
                        super(MiMoChatCompletionClient, self)._inner_get_response(
                            messages=messages,
                            options=fallback_options,
                            stream=False,
                            **kwargs,
                        ),
                    )
                raise

        return _get()

    def _parse_response_from_openai(self, response: Any, options: Mapping[str, Any]) -> Any:
        parsed = super()._parse_response_from_openai(response, options)
        annotations: list[dict[str, Any]] = []
        for message, choice in zip(parsed.messages, response.choices):
            serialized = _serialize_annotations(getattr(choice.message, "annotations", None))
            if not serialized:
                continue
            message.additional_properties = dict(message.additional_properties or {})
            message.additional_properties["annotations"] = serialized
            annotations.extend(serialized)
        if annotations:
            parsed.additional_properties = dict(parsed.additional_properties or {})
            parsed.additional_properties["annotations"] = annotations
        return parsed

    def _parse_response_update_from_openai(self, chunk: Any) -> Any:
        parsed = super()._parse_response_update_from_openai(chunk)
        annotations: list[dict[str, Any]] = []
        for choice in getattr(chunk, "choices", []):
            annotations.extend(_serialize_annotations(getattr(choice.delta, "annotations", None)))
        if annotations:
            parsed.additional_properties = dict(parsed.additional_properties or {})
            parsed.additional_properties["annotations"] = annotations
        return parsed


def _options_without_web_search(options: Mapping[str, Any]) -> dict[str, Any] | None:
    tools = options.get("tools")
    if tools is None:
        return None

    filtered_tools: list[Any] = []
    removed = False
    for item in normalize_tools(tools):
        if isinstance(item, MutableMapping) and item.get("type") == "web_search":
            removed = True
            continue
        filtered_tools.append(item)

    if not removed:
        return None

    next_options = dict(options)
    if filtered_tools:
        next_options["tools"] = filtered_tools
    else:
        next_options.pop("tools", None)
        next_options.pop("tool_choice", None)
    return next_options


def _should_retry_without_web_search(exc: Exception) -> bool:
    text = _flatten_exception_text(exc).lower()
    keywords = ("web_search", "web search", "plugin", "unsupported", "not activated", "not enabled")
    return any(keyword in text for keyword in keywords)


def _flatten_exception_text(exc: Exception) -> str:
    parts = [str(exc)]
    if isinstance(exc, ChatClientException) and getattr(exc, "inner_exception", None) is not None:
        parts.append(str(exc.inner_exception))
    if exc.__cause__ is not None:
        parts.append(str(exc.__cause__))
    return " ".join(part for part in parts if part)


def _serialize_annotations(raw_annotations: Any) -> list[dict[str, Any]]:
    if not raw_annotations:
        return []

    serialized: list[dict[str, Any]] = []
    for item in raw_annotations:
        if hasattr(item, "model_dump"):
            payload = item.model_dump(exclude_none=True)
        elif isinstance(item, Mapping):
            payload = {key: value for key, value in item.items() if value is not None}
        else:
            payload = {"value": str(item)}
        serialized.append(payload)
    return serialized
