from collections.abc import Awaitable, Callable
from inspect import isawaitable

from agent_framework import AgentSession, InMemoryHistoryProvider
from agent_framework.openai import OpenAIChatCompletionClient

from .config import get_config
from .context import CurrentInfoProvider
from .tools import TODO_TOOLS


_agent = None
_agent_config = None
_session = None
TOOL_CONTENT_TYPES = {"function_call", "function_result", "function_approval_request"}
AGENT_INSTRUCTIONS = """
You are a student productivity assistant.
Use the manage_todo_list tool whenever the user asks to read, add, update, complete, reopen, or delete todos.
If the user wants to update or delete a todo but the id is unclear, list the todos first so you can act on the correct item.
When a todo changes, mention the todo id in your reply.
""".strip()


def get_agent():
    global _agent, _agent_config, _session

    config = get_config()
    api_key = config["openaiApiKey"]
    model = config["openaiChatModel"]
    endpoint = config["openaiEndpoint"]

    next_config = (api_key, model, endpoint)
    if _agent is None or _agent_config != next_config:
        _agent = OpenAIChatCompletionClient(
            model=model,
            api_key=api_key or "unused",
            base_url=endpoint or None,
        ).as_agent(
            instructions=AGENT_INSTRUCTIONS,
            tools=TODO_TOOLS,
            context_providers=[
                InMemoryHistoryProvider("memory", load_messages=True),
                CurrentInfoProvider(),
            ],
        )
        _agent_config = next_config
        _session = _agent.create_session()

    return _agent


def get_session() -> AgentSession:
    get_agent()
    if _session is None:
        raise RuntimeError("Agent session is not initialized.")
    return _session


async def run_prompt(message: str) -> str:
    return await stream_prompt(message, lambda _chunk: None)


async def stream_prompt(
    message: str,
    on_chunk: Callable[[str], Awaitable[None] | None],
) -> str:
    agent = get_agent()
    stream = agent.run(message, stream=True, session=get_session())

    async for update in stream:
        tool_contents = [
            content for content in update.contents if content.type in TOOL_CONTENT_TYPES
        ]
        if tool_contents:
            # TODO: Replace this placeholder tool streaming with structured tool-event handling.
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

            maybe_awaitable = on_chunk("\n" + "\n".join(tool_lines) + "\n")
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
