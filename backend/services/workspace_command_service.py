"""Command execution helpers scoped to the configured workspace."""

from __future__ import annotations

import subprocess
import sys
import os
from collections.abc import Sequence
from typing import Any

from . import workspace_service

COMMAND_TIMEOUT_SECONDS = 20
COMMAND_OUTPUT_MAX_BYTES = 32 * 1024


def _truncate_output(text: str, remaining_bytes: int) -> tuple[str, bool]:
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= remaining_bytes:
        return text, False
    clipped = encoded[:remaining_bytes].decode("utf-8", errors="replace")
    return clipped, True


def _capture_result(
    *,
    command: Sequence[str],
    cwd_relative: str,
    env: dict[str, str],
) -> dict[str, Any]:
    cwd_path = workspace_service.resolve_workspace_path(cwd_relative)
    try:
        completed = subprocess.run(
            list(command),
            cwd=cwd_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=COMMAND_TIMEOUT_SECONDS,
            env=env,
        )
        remaining = COMMAND_OUTPUT_MAX_BYTES
        stdout, stdout_truncated = _truncate_output(completed.stdout, remaining)
        remaining -= len(stdout.encode("utf-8", errors="replace"))
        stderr, stderr_truncated = _truncate_output(completed.stderr, max(0, remaining))
        return {
            "relative_working_directory": workspace_service.normalize_relative_path(cwd_relative),
            "exit_code": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "timed_out": False,
            "truncated_output": stdout_truncated or stderr_truncated,
        }
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        stdout, stdout_truncated = _truncate_output(str(stdout), COMMAND_OUTPUT_MAX_BYTES)
        remaining = COMMAND_OUTPUT_MAX_BYTES - len(stdout.encode("utf-8", errors="replace"))
        stderr, stderr_truncated = _truncate_output(str(stderr), max(0, remaining))
        return {
            "relative_working_directory": workspace_service.normalize_relative_path(cwd_relative),
            "exit_code": None,
            "stdout": stdout,
            "stderr": stderr,
            "timed_out": True,
            "truncated_output": stdout_truncated or stderr_truncated,
        }


def run_workspace_shell(command: str, *, relative_working_directory: str = ".") -> dict[str, Any]:
    root = workspace_service.ensure_workspace_layout()
    result = _capture_result(
        command=["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        cwd_relative=relative_working_directory,
        env={
            **dict(os.environ),
            "AGENT_WORKSPACE_ROOT": str(root),
        },
    )
    result["command"] = command
    result["tool"] = "run_workspace_shell"
    return result


def run_workspace_python(
    code: str,
    *,
    relative_working_directory: str = ".",
    arguments: Sequence[str] | None = None,
) -> dict[str, Any]:
    root = workspace_service.ensure_workspace_layout()
    command = [sys.executable, "-c", code, *(list(arguments or []))]
    result = _capture_result(
        command=command,
        cwd_relative=relative_working_directory,
        env={
            **dict(os.environ),
            "AGENT_WORKSPACE_ROOT": str(root),
        },
    )
    result["tool"] = "run_workspace_python"
    result["python_executable"] = sys.executable
    result["arguments"] = list(arguments or [])
    return result
