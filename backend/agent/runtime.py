"""Agent runtime lifecycle and streaming helpers."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from inspect import isawaitable
from typing import Any

from agent_framework import AgentSession, InMemoryHistoryProvider
from agent_framework.openai import OpenAIChatCompletionClient

from ..config import get_config
from .context import CurrentInfoProvider
from .instructions import AGENT_INSTRUCTIONS
from .tools import TOOLS


TOOL_CONTENT_TYPES = {"function_call", "function_result", "function_approval_request"}


class AgentRuntime:
    """Owns agent client creation, session reuse, and stream formatting."""

    def __init__(self) -> None:
        self._agent: Any | None = None
        self._agent_config: tuple[str | None, str | None, str | None] | None = None
        self._session: AgentSession | None = None

    def get_agent(self) -> Any:
        config = get_config()
        api_key = config["openaiApiKey"]
        model = config["openaiChatModel"]
        endpoint = config["openaiEndpoint"]

        next_config = (api_key, model, endpoint)
        if self._agent is None or self._agent_config != next_config:
            self._agent = OpenAIChatCompletionClient(
                model=model,
                api_key=api_key or "unused",
                base_url=endpoint or None,
            ).as_agent(
                instructions=AGENT_INSTRUCTIONS,
                tools=TOOLS,
                context_providers=[
                    InMemoryHistoryProvider("memory", load_messages=True),
                    CurrentInfoProvider(),
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

    async def run_prompt(self, message: str) -> str:
        return await self.stream_prompt(message, lambda _chunk: None)

    async def stream_prompt(
        self,
        message: str,
        on_chunk: Callable[[str], Awaitable[None] | None],
    ) -> str:
        agent = self.get_agent()
        stream = agent.run(message, stream=True, session=self.get_session())

        async for update in stream:
            tool_contents = [
                content for content in update.contents if content.type in TOOL_CONTENT_TYPES
            ]
            if tool_contents:
                maybe_awaitable = on_chunk(self._format_tool_updates(tool_contents))
                if isawaitable(maybe_awaitable):
                    await maybe_awaitable
                continue

            chunk = update.text
            if not chunk:
                continue

            maybe_awaitable = on_chunk(chunk)
            if isawaitable(maybe_awaitable):
                await maybe_awaitable

        reply = ((await stream.get_final_response()).text or "").strip()
        if not reply:
            raise RuntimeError("The agent returned an empty reply.")
        return reply

    def _format_tool_updates(self, tool_contents: list[Any]) -> str:
        tool_lines = []
        for content in tool_contents:
            if content.type == "function_call":
                tool_lines.append(
                    f"[tool call] {getattr(content, 'name', 'unknown')}({getattr(content, 'arguments', '')})"
                )
            elif content.type == "function_result":
                tool_lines.append(f"[tool result] {getattr(content, 'result', '')}")
            else:
                tool_lines.append(f"[tool] {content.type}")

        return "\n" + "\n".join(tool_lines) + "\n"


agent_runtime = AgentRuntime()


def get_agent() -> Any:
    return agent_runtime.get_agent()


def get_session() -> AgentSession:
    return agent_runtime.get_session()


async def run_prompt(message: str) -> str:
    return await agent_runtime.run_prompt(message)


async def stream_prompt(
    message: str,
    on_chunk: Callable[[str], Awaitable[None] | None],
) -> str:
    return await agent_runtime.stream_prompt(message, on_chunk)
