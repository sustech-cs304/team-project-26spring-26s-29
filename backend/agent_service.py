"""Compatibility wrappers for the legacy agent runtime module."""

from .agent import agent_runtime, get_agent, get_session, run_prompt, stream_prompt

__all__ = ["agent_runtime", "get_agent", "get_session", "run_prompt", "stream_prompt"]
