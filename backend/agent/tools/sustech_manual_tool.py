"""SUSTech manual knowledge-base tools for the agent."""

from __future__ import annotations

from typing import Annotated, Any

from agent_framework import tool
from pydantic import Field

from ...services.sustech_manual_service import (
    SUSTechManualCorpusError,
    fetch_sustech_manual_online as fetch_online_source,
    read_sustech_manual_record as read_manual_record,
    search_sustech_manual as search_manual,
)


def search_sustech_manual(
    query: Annotated[str, Field(description="Search query for SUSTech manual text.")],
    max_matches: Annotated[
        int,
        Field(description="Maximum number of matches to return. Use 10 unless the user asks for breadth."),
    ] = 10,
) -> dict[str, Any]:
    """Search the generated SUSTech manual text corpus."""
    try:
        return search_manual(query, max_matches=max(1, min(max_matches, 20)))
    except SUSTechManualCorpusError as exc:
        return {"ok": False, "error": str(exc), "matches": []}


def read_sustech_manual_record(
    record_id: Annotated[str, Field(description="Record id returned by search_sustech_manual.")],
) -> dict[str, Any]:
    """Read a generated SUSTech manual record by id."""
    try:
        return read_manual_record(record_id)
    except SUSTechManualCorpusError as exc:
        return {"ok": False, "error": str(exc)}


def fetch_sustech_manual_online(
    source_path: Annotated[
        str,
        Field(description="Docs-relative source path, such as calendar/2025-2026.md."),
    ],
) -> dict[str, Any]:
    """Fetch the current live SUSTech manual page for a docs-relative source path."""
    try:
        return fetch_online_source(source_path)
    except (SUSTechManualCorpusError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}


search_sustech_manual_tool = tool(
    name="search_sustech_manual",
    description=(
        "Search the local generated SUSTech manual knowledge base for campus services, "
        "locations, calendars, transport, canteens, contacts, study, and life guides. "
        "Results include source_commit and source_commit_time."
    ),
    approval_mode="never_require",
)(search_sustech_manual)

read_sustech_manual_record_tool = tool(
    name="read_sustech_manual_record",
    description=(
        "Read one exact local SUSTech manual record by record_id. Use this before answering "
        "precise dates, phone numbers, locations, fees, procedures, rules, or links."
    ),
    approval_mode="never_require",
)(read_sustech_manual_record)

fetch_sustech_manual_online_tool = tool(
    name="fetch_sustech_manual_online",
    description=(
        "Fetch the current live SUSTech manual page for a docs-relative source path. "
        "This refuses absolute paths, URLs, and '../' traversal, and returns local corpus "
        "source_commit/source_commit_time for comparison."
    ),
    approval_mode="never_require",
)(fetch_sustech_manual_online)

SUSTECH_MANUAL_TOOLS = [
    search_sustech_manual_tool,
    read_sustech_manual_record_tool,
    fetch_sustech_manual_online_tool,
]
