"""Current runtime context provider for the agent."""

from __future__ import annotations

import asyncio
import json
import platform
import time
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from agent_framework import AgentSession, ContextProvider, SessionContext


_IPINFO_URL = "https://ipinfo.io/json"
_IPINFO_TIMEOUT_SECONDS = 3.0
_IPINFO_CACHE_TTL_SECONDS = 300.0


class CurrentInfoProvider(ContextProvider):
    """Inject current runtime environment information into each agent run."""

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
        network = await _resolve_public_ip_info(session)
        snapshot = _build_runtime_snapshot(session.session_id, network=network)
        state["snapshot"] = snapshot
        session.state["current_info"] = snapshot
        context.metadata["current_info"] = snapshot
        context.extend_instructions(self.source_id, _format_runtime_snapshot(snapshot))


def _build_runtime_snapshot(session_id: str, *, network: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now().astimezone()
    return {
        "now": {
            "iso": now.isoformat(),
            "timezone": str(now.tzinfo),
            "weekday": now.strftime("%A"),
            "date": now.date().isoformat(),
            "time": now.strftime("%H:%M"),
        },
        "session": {
            "session_id": session_id,
        },
        "system": _build_system_info(),
        "network": network,
    }


def _build_system_info() -> dict[str, str]:
    return {
        "os": platform.system() or "unknown",
        "arch": platform.machine() or "unknown",
        "python": platform.python_version(),
    }


async def _resolve_public_ip_info(session: AgentSession) -> dict[str, Any]:
    cached = session.state.get("_current_info_network_cache")
    now = time.monotonic()
    if isinstance(cached, dict):
        expires_at = cached.get("expires_at")
        cached_value = cached.get("value")
        if isinstance(expires_at, (int, float)) and expires_at > now and isinstance(cached_value, dict):
            return dict(cached_value)

    network = await asyncio.to_thread(_fetch_public_ip_info)
    session.state["_current_info_network_cache"] = {
        "expires_at": now + _IPINFO_CACHE_TTL_SECONDS,
        "value": dict(network),
    }
    return network


def _fetch_public_ip_info() -> dict[str, Any]:
    request = Request(
        _IPINFO_URL,
        headers={
            "Accept": "application/json",
            "User-Agent": "team-project-26spring-runtime/1.0",
        },
    )
    try:
        with urlopen(request, timeout=_IPINFO_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return _build_unavailable_network_info(f"HTTP {exc.code} from ipinfo.io")
    except URLError as exc:
        reason = exc.reason if exc.reason else str(exc)
        return _build_unavailable_network_info(f"Network error contacting ipinfo.io: {reason}")
    except TimeoutError:
        return _build_unavailable_network_info("Timed out contacting ipinfo.io")
    except json.JSONDecodeError as exc:
        return _build_unavailable_network_info(f"Invalid JSON from ipinfo.io: {exc}")
    except Exception as exc:
        return _build_unavailable_network_info(str(exc))

    if not isinstance(payload, dict):
        return _build_unavailable_network_info("Unexpected response shape from ipinfo.io")

    return {
        "provider": "ipinfo.io",
        "available": True,
        "ip": str(payload.get("ip") or ""),
        "city": str(payload.get("city") or ""),
        "region": str(payload.get("region") or ""),
        "country": str(payload.get("country") or ""),
        "loc": str(payload.get("loc") or ""),
        "org": str(payload.get("org") or ""),
        "postal": str(payload.get("postal") or ""),
        "timezone": str(payload.get("timezone") or ""),
    }


def _build_unavailable_network_info(error: str) -> dict[str, Any]:
    return {
        "provider": "ipinfo.io",
        "available": False,
        "error": error,
    }


def _format_runtime_snapshot(snapshot: dict[str, Any]) -> str:
    now = snapshot["now"]
    session = snapshot["session"]
    system = snapshot["system"]
    network = snapshot["network"]

    lines = [
        "Current runtime context:",
        (
            f"- Time: {now['iso']} ({now['timezone']}, "
            f"{now['weekday']}, local date {now['date']})"
        ),
        f"- Session: {session['session_id']}",
        (
            "- Runtime: "
            f"{system['os']} {system['arch']} | Python {system['python']}"
        ),
    ]

    if not network["available"]:
        lines.append(f"- Public IP: unavailable ({network['error']})")
    else:
        location = ", ".join(
            value for value in (network["city"], network["region"], network["country"]) if value
        )
        ip_line = network["ip"] or "unknown"
        if location:
            ip_line = f"{ip_line} ({location})"
        if network["org"]:
            ip_line = f"{ip_line} via {network['org']}"
        lines.append(f"- Public IP: {ip_line}")
        if network["timezone"]:
            lines.append(f"- Network timezone: {network['timezone']}")

    lines.append("- Use this context as runtime environment metadata for the current run.")
    return "\n".join(lines)
