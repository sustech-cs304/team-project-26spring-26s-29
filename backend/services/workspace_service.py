"""Workspace path, file metadata, preview payloads, and text-decoding helpers."""

from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from ..config import get_config
from .document_service import (
    DOCUMENT_TEXT_MAX_CHARACTERS,
    extract_document_text,
    is_supported_document_path,
    is_temporal_media_type,
)

TEXT_DECODING_CANDIDATES = ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "gb18030")
SUMMARY_PREVIEW_MAX_CHARACTERS = 4000
READ_FILE_MAX_CHARACTERS = 20000
LIST_FILES_MAX_ENTRIES = 200
SEARCH_MAX_MATCHES = 50
PREVIEW_TEXT_MAX_CHARACTERS = 8000
PREVIEW_INLINE_MAX_BYTES = 8 * 1024 * 1024
TEXT_DOCUMENT_EXTENSIONS = {".csv", ".html", ".htm", ".json", ".md", ".txt", ".xml"}


@dataclass(frozen=True)
class WorkspaceTextResult:
    text: str
    encoding: str
    truncated: bool


def get_workspace_root() -> Path:
    configured = get_config().get("workspacePath")
    if isinstance(configured, str) and configured.strip():
        return Path(configured).expanduser().resolve()
    return (Path.cwd() / "workspace").resolve()


def ensure_workspace_layout() -> Path:
    root = get_workspace_root()
    (root / "inputs").mkdir(parents=True, exist_ok=True)
    (root / "outputs").mkdir(parents=True, exist_ok=True)
    return root


def normalize_relative_path(relative_path: str | None) -> str:
    text = str(relative_path or ".").strip().replace("\\", "/")
    if not text:
        text = "."

    normalized = PurePosixPath(text)
    if normalized.is_absolute():
        raise ValueError("Workspace paths must be relative to the workspace root.")

    parts = [part for part in normalized.parts if part not in ("", ".")]
    if any(part == ".." for part in parts):
        raise ValueError("Workspace path escapes are not allowed.")

    return "/".join(parts) or "."


def resolve_workspace_path(relative_path: str | None = ".") -> Path:
    root = ensure_workspace_layout()
    normalized = normalize_relative_path(relative_path)
    candidate = root if normalized == "." else (root / Path(*normalized.split("/"))).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Workspace path escapes are not allowed.")
    return candidate


def to_workspace_relative_path(target_path: str | Path) -> str:
    root = ensure_workspace_layout()
    candidate = Path(target_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Target path is outside the workspace root.")
    if candidate == root:
        return "."
    return candidate.relative_to(root).as_posix()


def decode_text_bytes(payload: bytes) -> tuple[str, str] | None:
    if is_probably_binary_bytes(payload):
        return None
    for encoding in TEXT_DECODING_CANDIDATES:
        try:
            return payload.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return None


def is_probably_binary_bytes(payload: bytes) -> bool:
    if not payload:
        return False

    sample = payload[:512]
    suspicious = 0
    for value in sample:
        if value == 0:
            return True
        if value < 7 or (13 < value < 32):
            suspicious += 1

    return (suspicious / len(sample)) > 0.1


def is_probably_text(text: str) -> bool:
    if not text:
        return True

    suspicious = 0
    for char in text:
        code = ord(char)
        if code in (9, 10, 13):
            continue
        if code < 32 or code == 65533:
            suspicious += 1

    return (suspicious / len(text)) < 0.05


def summarize_text(text: str, *, max_characters: int = SUMMARY_PREVIEW_MAX_CHARACTERS) -> str | None:
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return None
    return normalized[:max_characters]


def guess_workspace_media_type(relative_path: str) -> str:
    normalized = normalize_relative_path(relative_path)
    media_type, _encoding = mimetypes.guess_type(normalized)
    return media_type or "application/octet-stream"


def read_text_from_workspace(
    relative_path: str,
    *,
    max_characters: int = READ_FILE_MAX_CHARACTERS,
) -> WorkspaceTextResult | None:
    file_path = resolve_workspace_path(relative_path)
    if not file_path.is_file():
        raise FileNotFoundError(f"Workspace file does not exist: {normalize_relative_path(relative_path)}")

    decoded = decode_text_bytes(file_path.read_bytes())
    if decoded is None:
        return None

    text, encoding = decoded
    if not is_probably_text(text):
        return None

    truncated = len(text) > max_characters
    return WorkspaceTextResult(
        text=text[:max_characters],
        encoding=encoding,
        truncated=truncated,
    )


def build_file_reference_text(
    *,
    name: str,
    media_type: str,
    size_bytes: int | None,
    relative_path: str,
    capability: str | None = None,
    readability: str | None = None,
    summary_text: str | None = None,
    inline_note: str | None = None,
    message: str | None = None,
) -> str:
    lines = [
        "Attached workspace file:",
        f"- Name: {name}",
        f"- Media-Type: {media_type}",
        f"- Workspace Path: {normalize_relative_path(relative_path)}",
    ]
    if size_bytes is not None:
        lines.append(f"- Size Bytes: {size_bytes}")
    if capability:
        lines.append(f"- Capability: {capability}")
    if readability:
        lines.append(f"- Readability: {readability}")
    if inline_note:
        lines.append(f"- Note: {inline_note}")
    if message:
        lines.append(f"- Status: {message}")
    if summary_text:
        lines.extend(["- Preview:", summary_text])
    return "\n".join(lines)


def list_workspace_entries(relative_path: str = ".", *, max_entries: int = LIST_FILES_MAX_ENTRIES) -> dict[str, Any]:
    root = resolve_workspace_path(relative_path)
    if not root.exists():
        raise FileNotFoundError(f"Workspace path does not exist: {normalize_relative_path(relative_path)}")
    if root.is_file():
        return {
            "workspace_root": str(ensure_workspace_layout()),
            "base_path": normalize_relative_path(relative_path),
            "entries": [
                {
                    "relative_path": to_workspace_relative_path(root),
                    "kind": "file",
                    "size_bytes": root.stat().st_size,
                }
            ],
            "truncated": False,
        }

    entries: list[dict[str, Any]] = []
    truncated = False
    for candidate in sorted(root.rglob("*"), key=lambda item: item.as_posix().lower()):
        if len(entries) >= max_entries:
            truncated = True
            break
        entries.append(
            {
                "relative_path": to_workspace_relative_path(candidate),
                "kind": "directory" if candidate.is_dir() else "file",
                "size_bytes": None if candidate.is_dir() else candidate.stat().st_size,
            }
        )

    return {
        "workspace_root": str(ensure_workspace_layout()),
        "base_path": normalize_relative_path(relative_path),
        "entries": entries,
        "truncated": truncated,
    }


def read_workspace_file(relative_path: str, *, max_characters: int = READ_FILE_MAX_CHARACTERS) -> dict[str, Any]:
    file_path = resolve_workspace_path(relative_path)
    if file_path.is_dir():
        raise IsADirectoryError(f"Workspace path is a directory: {normalize_relative_path(relative_path)}")
    if not file_path.exists():
        raise FileNotFoundError(f"Workspace file does not exist: {normalize_relative_path(relative_path)}")

    normalized = normalize_relative_path(relative_path)
    media_type = guess_workspace_media_type(normalized)
    if is_supported_document_path(file_path) and file_path.suffix.lower() not in TEXT_DOCUMENT_EXTENSIONS:
        extraction = extract_document_text(
            file_path,
            media_type=media_type,
            max_characters=min(max_characters, DOCUMENT_TEXT_MAX_CHARACTERS),
        )
        payload: dict[str, Any] = {
            "relative_path": normalized,
            "size_bytes": file_path.stat().st_size,
            "media_type": media_type,
            "is_text": extraction.readable,
            "is_document": True,
            "document": extraction.to_dict(),
        }
        if extraction.readable:
            payload.update(
                {
                    "encoding": "extracted",
                    "truncated": extraction.truncated,
                    "text": extraction.text,
                }
            )
        else:
            payload["message"] = extraction.message
        return payload

    text_result = read_text_from_workspace(relative_path, max_characters=max_characters)
    payload: dict[str, Any] = {
        "relative_path": normalized,
        "size_bytes": file_path.stat().st_size,
        "is_text": text_result is not None,
    }
    if text_result is None:
        if is_supported_document_path(file_path):
            extraction = extract_document_text(
                file_path,
                media_type=media_type,
                max_characters=min(max_characters, DOCUMENT_TEXT_MAX_CHARACTERS),
            )
            payload.update(
                {
                    "media_type": media_type,
                    "is_document": True,
                    "document": extraction.to_dict(),
                }
            )
            if extraction.readable:
                payload.update(
                    {
                        "is_text": True,
                        "encoding": "extracted",
                        "truncated": extraction.truncated,
                        "text": extraction.text,
                    }
                )
            else:
                payload["message"] = extraction.message
            return payload

        payload["media_type"] = media_type
        payload["message"] = _unsupported_file_message(media_type)
        return payload

    payload.update(
        {
            "encoding": text_result.encoding,
            "truncated": text_result.truncated,
            "text": text_result.text,
        }
    )
    return payload


def build_workspace_preview(
    relative_path: str,
    *,
    max_text_characters: int = PREVIEW_TEXT_MAX_CHARACTERS,
    max_inline_bytes: int = PREVIEW_INLINE_MAX_BYTES,
) -> dict[str, Any]:
    normalized = normalize_relative_path(relative_path)
    file_path = resolve_workspace_path(normalized)
    if file_path.is_dir():
        raise IsADirectoryError(f"Workspace path is a directory: {normalized}")
    if not file_path.exists():
        raise FileNotFoundError(f"Workspace file does not exist: {normalized}")

    size_bytes = file_path.stat().st_size
    media_type = guess_workspace_media_type(normalized)
    payload: dict[str, Any] = {
        "relative_path": normalized,
        "name": file_path.name,
        "size_bytes": size_bytes,
        "media_type": media_type,
        "preview_type": "file",
        "message": "This file can be opened from the workspace, but no inline preview is available.",
    }

    preview_type = _preview_type_for_media_type(media_type)
    if preview_type is not None:
        if size_bytes > max_inline_bytes:
            payload.update(
                {
                    "preview_type": preview_type,
                    "message": f"This {preview_type} is too large for inline preview ({size_bytes} bytes).",
                }
            )
            return payload

        encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
        payload.update(
            {
                "preview_type": preview_type,
                "data_base64": encoded,
                "message": f"{preview_type.title()} preview prepared.",
            }
        )
        return payload

    if is_temporal_media_type(media_type):
        payload["message"] = "Audio and video files are not supported for preview or direct reading."
        return payload

    if is_supported_document_path(file_path):
        extraction = extract_document_text(
            file_path,
            media_type=media_type,
            max_characters=DOCUMENT_TEXT_MAX_CHARACTERS,
        )
        payload.update(
            {
                "preview_type": "document",
                "document": extraction.to_dict(),
                "truncated": extraction.truncated,
                "message": extraction.message,
            }
        )
        if extraction.readable:
            payload["text"] = extraction.text
        return payload

    text_result = read_text_from_workspace(normalized, max_characters=max_text_characters)
    if text_result is not None:
        preview_text = summarize_text(text_result.text, max_characters=max_text_characters) or ""
        payload.update(
            {
                "preview_type": "text",
                "encoding": text_result.encoding,
                "text": preview_text,
                "truncated": text_result.truncated,
                "message": (
                    "Text preview prepared."
                    if not text_result.truncated
                    else f"Text preview truncated to the first {max_text_characters} characters."
                ),
            }
        )
        return payload

    payload["message"] = _unsupported_file_message(media_type)
    return payload


def search_workspace_text(
    query: str,
    *,
    relative_path: str = ".",
    case_sensitive: bool = False,
    max_matches: int = SEARCH_MAX_MATCHES,
) -> dict[str, Any]:
    normalized_query = query if case_sensitive else query.lower()
    if not normalized_query:
        raise ValueError("Search query cannot be empty.")

    root = resolve_workspace_path(relative_path)
    if not root.exists():
        raise FileNotFoundError(f"Workspace path does not exist: {normalize_relative_path(relative_path)}")

    matches: list[dict[str, Any]] = []
    scanned_files = 0
    skipped_files = 0

    candidates = [root] if root.is_file() else sorted(root.rglob("*"), key=lambda item: item.as_posix().lower())
    for candidate in candidates:
        if not candidate.is_file():
            continue

        scanned_files += 1
        relative_candidate = to_workspace_relative_path(candidate)
        text_result = read_text_from_workspace(relative_candidate, max_characters=READ_FILE_MAX_CHARACTERS)
        if text_result is None:
            skipped_files += 1
            continue

        for line_number, line in enumerate(text_result.text.splitlines(), start=1):
            haystack = line if case_sensitive else line.lower()
            if normalized_query not in haystack:
                continue
            matches.append(
                {
                    "relative_path": relative_candidate,
                    "line_number": line_number,
                    "line_text": line[:300],
                }
            )
            if len(matches) >= max_matches:
                return {
                    "query": query,
                    "base_path": normalize_relative_path(relative_path),
                    "matches": matches,
                    "truncated": True,
                    "scanned_files": scanned_files,
                    "skipped_files": skipped_files,
                }

    return {
        "query": query,
        "base_path": normalize_relative_path(relative_path),
        "matches": matches,
        "truncated": False,
        "scanned_files": scanned_files,
        "skipped_files": skipped_files,
    }


def write_workspace_file(relative_path: str, content: str, *, overwrite: bool) -> dict[str, Any]:
    file_path = resolve_workspace_path(relative_path)
    if file_path.exists() and file_path.is_dir():
        raise IsADirectoryError(f"Workspace path is a directory: {normalize_relative_path(relative_path)}")
    if file_path.exists() and not overwrite:
        raise FileExistsError(f"Workspace file already exists: {normalize_relative_path(relative_path)}")
    if file_path.exists() and overwrite and read_text_from_workspace(relative_path, max_characters=READ_FILE_MAX_CHARACTERS) is None:
        raise ValueError("Only decodable text files can be updated through workspace file tools.")

    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    return {
        "relative_path": normalize_relative_path(relative_path),
        "size_bytes": file_path.stat().st_size,
        "encoding": "utf-8",
    }


def append_workspace_file(relative_path: str, content: str) -> dict[str, Any]:
    file_path = resolve_workspace_path(relative_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Workspace file does not exist: {normalize_relative_path(relative_path)}")

    existing = read_text_from_workspace(relative_path, max_characters=READ_FILE_MAX_CHARACTERS)
    if existing is None:
        raise ValueError("Only decodable text files can be updated through workspace file tools.")

    with file_path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(content)

    return {
        "relative_path": normalize_relative_path(relative_path),
        "size_bytes": file_path.stat().st_size,
        "encoding": "utf-8",
        "previous_encoding": existing.encoding,
    }


def build_workspace_snapshot() -> dict[str, Any]:
    root = ensure_workspace_layout()
    input_root = root / "inputs"
    output_root = root / "outputs"
    recent_files = sorted(
        (
            to_workspace_relative_path(candidate)
            for candidate in root.rglob("*")
            if candidate.is_file()
        ),
        key=str.lower,
    )[:25]
    return {
        "workspace_root": str(root),
        "inputs_root": str(input_root),
        "outputs_root": str(output_root),
        "recent_files": recent_files,
    }


def format_workspace_snapshot(snapshot: dict[str, Any]) -> str:
    lines = [
        "Workspace context:",
        f"- Workspace Root: {snapshot['workspace_root']}",
        f"- Uploaded inputs live under: {snapshot['inputs_root']}",
        f"- Generated outputs should usually go under: {snapshot['outputs_root']}",
        "- All workspace paths shared with the model use forward slashes and are relative to the workspace root.",
        "- Markdown image URLs in assistant replies are resolved relative to the workspace root.",
        "- Prefer workspace file tools for listing, reading, creating, and updating files.",
        "- Use shell/python only when file tools are insufficient or you need program execution.",
    ]
    if snapshot["recent_files"]:
        lines.append("- Current workspace files:")
        lines.extend(f"  - {item}" for item in snapshot["recent_files"])
    return "\n".join(lines)


def _preview_type_for_media_type(media_type: str) -> str | None:
    normalized = str(media_type or "").lower()
    if normalized.startswith("image/"):
        return "image"
    return None


def _unsupported_file_message(media_type: str | None) -> str:
    if is_temporal_media_type(media_type):
        return "Audio and video files are not supported. Do not infer their contents."
    return (
        "This file type is not directly readable. Do not infer its contents. "
        "If the user insists, ask before trying workspace Python for custom processing."
    )
