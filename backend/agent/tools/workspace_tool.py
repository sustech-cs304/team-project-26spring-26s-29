"""Workspace file and command tools for the agent."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from agent_framework import Content, tool
from pydantic import Field

from ...services import (
    append_workspace_file,
    build_workspace_preview,
    list_workspace_entries,
    read_workspace_file,
    run_workspace_python,
    run_workspace_shell,
    search_workspace_text,
    write_workspace_file,
)


def list_workspace_files(
    relative_path: Annotated[
        str,
        Field(description="Workspace-relative directory to inspect, using forward slashes."),
    ] = ".",
    max_entries: Annotated[
        int,
        Field(description="Maximum number of files/directories to return.", ge=1, le=500),
    ] = 200,
) -> dict[str, Any]:
    """List files and directories inside the current workspace."""
    return list_workspace_entries(relative_path, max_entries=max_entries)


def search_workspace_text_tool_impl(
    query: Annotated[
        str,
        Field(description="Text to search for across decodable workspace files."),
    ],
    relative_path: Annotated[
        str,
        Field(description="Workspace-relative directory to search inside."),
    ] = ".",
    case_sensitive: Annotated[
        bool,
        Field(description="Whether the search should preserve case."),
    ] = False,
    max_matches: Annotated[
        int,
        Field(description="Maximum number of matching lines to return.", ge=1, le=200),
    ] = 50,
) -> dict[str, Any]:
    """Search across text-like files inside the current workspace."""
    return search_workspace_text(
        query,
        relative_path=relative_path,
        case_sensitive=case_sensitive,
        max_matches=max_matches,
    )


def read_workspace_file_tool_impl(
    relative_path: Annotated[
        str,
        Field(description="Workspace-relative file path to read."),
    ],
    max_characters: Annotated[
        int,
        Field(description="Maximum number of characters to return for decodable text files.", ge=1, le=50000),
    ] = 20000,
) -> dict[str, Any]:
    """Read one workspace file. Binary files return metadata plus a guidance message."""
    return read_workspace_file(relative_path, max_characters=max_characters)


def preview_workspace_file_tool_impl(
    relative_path: Annotated[
        str,
        Field(description="Workspace-relative file path to preview."),
    ],
    max_text_characters: Annotated[
        int,
        Field(description="Maximum number of preview characters to return for text files.", ge=200, le=20000),
    ] = 8000,
) -> list[Content]:
    """Prepare an inline preview for text, image, PDF, audio, or video files in the workspace."""
    preview = build_workspace_preview(relative_path, max_text_characters=max_text_characters)
    summary = [
        f"Preview request prepared for {preview['relative_path']}.",
        f"Media-Type: {preview['media_type']}",
        f"Size Bytes: {preview['size_bytes']}",
        f"Preview Type: {preview['preview_type']}",
        f"Status: {preview['message']}",
    ]

    items: list[Content] = [Content.from_text("\n".join(summary))]
    if preview["preview_type"] == "text":
        items.append(
            Content.from_text(
                f"Text preview for {preview['relative_path']}:\n\n{preview.get('text') or '(empty file)'}"
            )
        )
        return items

    data_base64 = preview.get("data_base64")
    if not data_base64:
        return items

    items.append(
        Content.from_uri(
            uri=f"data:{preview['media_type']};base64,{data_base64}",
            media_type=preview["media_type"],
            additional_properties={
                "name": preview["name"],
                "relativePath": preview["relative_path"],
                "sizeBytes": preview["size_bytes"],
            },
        )
    )
    return items


def create_workspace_file(
    relative_path: Annotated[
        str,
        Field(description="Workspace-relative file path to create."),
    ],
    content: Annotated[
        str,
        Field(description="UTF-8 text content to write into the new file."),
    ],
) -> dict[str, Any]:
    """Create a new UTF-8 text file inside the workspace."""
    result = write_workspace_file(relative_path, content, overwrite=False)
    return {
        "action": "create",
        "message": f"Created workspace file {result['relative_path']}.",
        **result,
    }


def update_workspace_file(
    relative_path: Annotated[
        str,
        Field(description="Workspace-relative file path to update."),
    ],
    content: Annotated[
        str,
        Field(description="UTF-8 text to write or append."),
    ],
    mode: Annotated[
        Literal["replace", "append"],
        Field(description="Use replace to overwrite the full file or append to add to the end."),
    ] = "replace",
) -> dict[str, Any]:
    """Update an existing UTF-8-compatible text file inside the workspace."""
    if mode == "append":
        result = append_workspace_file(relative_path, content)
    else:
        existing = read_workspace_file(relative_path)
        if not existing.get("is_text"):
            raise ValueError("Only decodable text files can be updated through workspace file tools.")
        result = write_workspace_file(relative_path, content, overwrite=True)

    return {
        "action": mode,
        "message": f"Updated workspace file {result['relative_path']} with mode={mode}.",
        **result,
    }


def run_workspace_shell_tool_impl(
    command: Annotated[
        str,
        Field(description="PowerShell command to run inside the workspace."),
    ],
    relative_working_directory: Annotated[
        str,
        Field(description="Workspace-relative directory used as the current working directory."),
    ] = ".",
) -> dict[str, Any]:
    """Run a PowerShell command from within the workspace."""
    return run_workspace_shell(command, relative_working_directory=relative_working_directory)


def run_workspace_python_tool_impl(
    code: Annotated[
        str,
        Field(description="Inline Python code passed to python -c."),
    ],
    relative_working_directory: Annotated[
        str,
        Field(description="Workspace-relative directory used as the current working directory."),
    ] = ".",
    arguments: Annotated[
        list[str] | None,
        Field(description="Optional extra arguments appended after python -c <code>."),
    ] = None,
) -> dict[str, Any]:
    """Run inline Python code from within the workspace using the backend's Python runtime."""
    return run_workspace_python(
        code,
        relative_working_directory=relative_working_directory,
        arguments=arguments,
    )


list_workspace_files_tool = tool(
    name="list_workspace_files",
    description="List files and directories inside the current workspace.",
    approval_mode="never_require",
)(list_workspace_files)

search_workspace_text_tool = tool(
    name="search_workspace_text",
    description="Search across decodable text files in the current workspace.",
    approval_mode="never_require",
)(search_workspace_text_tool_impl)

read_workspace_file_tool = tool(
    name="read_workspace_file",
    description="Read one workspace file. Binary files return metadata instead of text.",
    approval_mode="never_require",
)(read_workspace_file_tool_impl)

preview_workspace_file_tool = tool(
    name="preview_workspace_file",
    description="Prepare an inline preview for text, image, PDF, audio, or video files in the workspace.",
    approval_mode="never_require",
)(preview_workspace_file_tool_impl)

create_workspace_file_tool = tool(
    name="create_workspace_file",
    description="Create a new UTF-8 text file inside the current workspace.",
    approval_mode="always_require",
)(create_workspace_file)

update_workspace_file_tool = tool(
    name="update_workspace_file",
    description="Replace or append text in an existing workspace file.",
    approval_mode="always_require",
)(update_workspace_file)

run_workspace_shell_tool = tool(
    name="run_workspace_shell",
    description="Run a PowerShell command inside the workspace.",
    approval_mode="always_require",
)(run_workspace_shell_tool_impl)

run_workspace_python_tool = tool(
    name="run_workspace_python",
    description="Run inline Python code inside the workspace using the backend Python runtime.",
    approval_mode="always_require",
)(run_workspace_python_tool_impl)

WORKSPACE_TOOLS = [
    list_workspace_files_tool,
    search_workspace_text_tool,
    read_workspace_file_tool,
    preview_workspace_file_tool,
    create_workspace_file_tool,
    update_workspace_file_tool,
    run_workspace_shell_tool,
    run_workspace_python_tool,
]
