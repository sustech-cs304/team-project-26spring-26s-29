"""Workspace context provider for the agent runtime."""

from __future__ import annotations

from typing import Any

from agent_framework import AgentSession, ContextProvider, SessionContext

from ...services import build_workspace_snapshot, format_workspace_snapshot


class WorkspaceInfoProvider(ContextProvider):
    """Inject configured workspace guidance into each agent run."""

    def __init__(self, source_id: str = "workspace_info") -> None:
        super().__init__(source_id)

    async def before_run(
        self,
        *,
        agent: Any,
        session: AgentSession,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        snapshot = build_workspace_snapshot()
        state["workspace_snapshot"] = snapshot
        session.state["workspace_info"] = snapshot
        context.metadata["workspace_info"] = snapshot
        context.extend_instructions(self.source_id, format_workspace_snapshot(snapshot))
