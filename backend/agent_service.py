import os

from agent_framework.openai import OpenAIChatClient


try:
    if not os.environ.get("OPENAI_API_KEY") or not os.environ.get("OPENAI_CHAT_MODEL"):
        raise RuntimeError("Missing OpenAI configuration.")

    agent = OpenAIChatClient().as_agent(instructions="Answer directly and briefly.")
except Exception as exc:
    raise RuntimeError(
        "Set OPENAI_API_KEY and OPENAI_CHAT_MODEL before starting the backend."
    ) from exc


async def run_prompt(message: str) -> str:
    reply = ((await agent.run(message)).text or "").strip()
    if not reply:
        raise RuntimeError("The agent returned an empty reply.")
    return reply
