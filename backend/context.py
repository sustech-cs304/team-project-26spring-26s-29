"""Context providers for injecting current runtime information into the agent."""

from __future__ import annotations

from typing import Any

from agent_framework import AgentSession, ContextProvider, SessionContext

from .services import todo_query_service


class CurrentInfoProvider(ContextProvider):
    """Inject current time and todo summary information into each agent run."""

    def __init__(self, source_id: str = "current_info") -> None:
        super().__init__(source_id)

    async def before_run(
        self,
        *,
        agent: Any,
        session: AgentSession,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        snapshot = todo_query_service.build_runtime_snapshot(session.session_id)
        state["snapshot"] = snapshot
        session.state["current_info"] = snapshot
        context.metadata["current_info"] = snapshot
        context.extend_instructions(self.source_id, todo_query_service.format_runtime_snapshot(snapshot))
