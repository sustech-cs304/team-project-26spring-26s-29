from agent_framework.openai import OpenAIChatCompletionClient

from .config import get_config


_agent = None
_agent_config = None


def get_agent():
    global _agent, _agent_config

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
        ).as_agent()
        _agent_config = next_config

    return _agent


async def run_prompt(message: str) -> str:
    agent = get_agent()
    reply = ((await agent.run(message)).text or "").strip()
    if not reply:
        raise RuntimeError("The agent returned an empty reply.")
    return reply
