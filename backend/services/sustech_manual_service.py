"""Read-only access to the generated SUSTech manual corpus."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CORPUS_ROOT = REPO_ROOT / "backend" / "knowledge" / "sustech_manual"
ONLINE_BASE_URL = "https://sustech.online"
MISSING_CORPUS_MESSAGE = (
    "SUSTech manual knowledge base is missing. Run `npm run build:sustech-manual` first."
)


class SUSTechManualCorpusError(RuntimeError):
    """Raised when the local SUSTech manual corpus cannot be read."""


def search_sustech_manual(
    query: str,
    *,
    max_matches: int = 10,
    corpus_root: Path = DEFAULT_CORPUS_ROOT,
) -> dict[str, Any]:
    """Search the generated SUSTech manual index."""
    query_terms = _terms(query)
    if not query_terms:
        return {
            "ok": False,
            "error": "Query must contain at least one non-whitespace term.",
            "matches": [],
        }

    manifest, index = _load_manifest_and_index(corpus_root)
    matches = []
    for entry in index.get("records", []):
        search_text = str(entry.get("search_text") or "").casefold()
        score = sum(search_text.count(term) for term in query_terms)
        if score <= 0:
            continue
        matches.append(
            {
                "score": score,
                "record_id": entry.get("record_id"),
                "title": entry.get("title"),
                "source_path": entry.get("source_path"),
                "preview": entry.get("preview"),
                "online_url": entry.get("online_url"),
                "source_commit": entry.get("source_commit"),
                "source_commit_time": entry.get("source_commit_time"),
                "license": entry.get("license"),
            }
        )

    matches.sort(key=lambda item: (-item["score"], item["source_path"] or ""))
    return {
        "ok": True,
        "query": query,
        "count": len(matches[:max_matches]),
        "source_commit": manifest["source_commit"],
        "source_commit_time": manifest["source_commit_time"],
        "matches": matches[:max_matches],
    }


def read_sustech_manual_record(
    record_id: str,
    *,
    corpus_root: Path = DEFAULT_CORPUS_ROOT,
) -> dict[str, Any]:
    """Read one generated SUSTech manual record by id."""
    manifest, index = _load_manifest_and_index(corpus_root)
    entry = next(
        (item for item in index.get("records", []) if item.get("record_id") == record_id),
        None,
    )
    if entry is None:
        return {
            "ok": False,
            "error": f"Unknown SUSTech manual record_id: {record_id}",
            "source_commit": manifest["source_commit"],
            "source_commit_time": manifest["source_commit_time"],
        }

    generated_path = _safe_generated_path(corpus_root, str(entry.get("generated_path") or ""))
    record = _read_json(generated_path)
    return {
        "ok": True,
        "source_commit": manifest["source_commit"],
        "source_commit_time": manifest["source_commit_time"],
        "record": record,
    }


def fetch_sustech_manual_online(
    source_path: str,
    *,
    corpus_root: Path = DEFAULT_CORPUS_ROOT,
    timeout_seconds: float = 10.0,
) -> dict[str, Any]:
    """Fetch the current live SUSTech manual page that corresponds to a source path."""
    manifest = _load_manifest(corpus_root)
    normalized = _normalize_source_path(source_path)
    url = _online_url_for_source_path(normalized)

    try:
        with urllib.request.urlopen(url, timeout=timeout_seconds) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        return {
            "ok": False,
            "error": f"Online source returned HTTP {exc.code}.",
            "source_path": normalized,
            "source_commit": manifest["source_commit"],
            "source_commit_time": manifest["source_commit_time"],
            "url": url,
        }
    except urllib.error.URLError as exc:
        return {
            "ok": False,
            "error": f"Online source fetch failed: {exc.reason}",
            "source_path": normalized,
            "source_commit": manifest["source_commit"],
            "source_commit_time": manifest["source_commit_time"],
            "url": url,
        }

    return {
        "ok": True,
        "source_path": normalized,
        "source_commit": manifest["source_commit"],
        "source_commit_time": manifest["source_commit_time"],
        "url": url,
        "text": body.decode("utf-8", errors="replace"),
    }


def _load_manifest_and_index(corpus_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    return _load_manifest(corpus_root), _load_index(corpus_root)


def _load_manifest(corpus_root: Path) -> dict[str, Any]:
    manifest_path = corpus_root / "manifest.json"
    if not manifest_path.exists():
        raise SUSTechManualCorpusError(MISSING_CORPUS_MESSAGE)
    manifest = _read_json(manifest_path)
    if not manifest.get("source_commit") or not manifest.get("source_commit_time"):
        raise SUSTechManualCorpusError("SUSTech manual manifest is missing source commit metadata.")
    return manifest


def _load_index(corpus_root: Path) -> dict[str, Any]:
    index_path = corpus_root / "index.json"
    if not index_path.exists():
        raise SUSTechManualCorpusError(MISSING_CORPUS_MESSAGE)
    index = _read_json(index_path)
    if not isinstance(index.get("records"), list):
        raise SUSTechManualCorpusError("SUSTech manual index is invalid.")
    return index


def _safe_generated_path(corpus_root: Path, generated_path: str) -> Path:
    if not generated_path:
        raise SUSTechManualCorpusError("SUSTech manual index entry is missing generated_path.")
    normalized = _normalize_source_path(generated_path)
    path = (corpus_root / "generated" / Path(*PurePosixPath(normalized).parts)).resolve()
    generated_root = (corpus_root / "generated").resolve()
    try:
        path.relative_to(generated_root)
    except ValueError as exc:
        raise SUSTechManualCorpusError("SUSTech manual generated_path escapes generated root.") from exc
    if not path.exists():
        raise SUSTechManualCorpusError(f"SUSTech manual generated record is missing: {generated_path}")
    return path


def _normalize_source_path(source_path: str) -> str:
    candidate = str(source_path or "").strip().replace("\\", "/")
    if not candidate:
        raise ValueError("source_path is required.")
    if candidate.startswith("/") or re.match(r"^[a-z][a-z0-9+.-]*://", candidate, re.IGNORECASE):
        raise ValueError("source_path must be a docs-relative path, not an absolute path or URL.")
    normalized = PurePosixPath(candidate)
    if any(part == ".." for part in normalized.parts):
        raise ValueError("source_path must not contain '..'.")
    return normalized.as_posix()


def _online_url_for_source_path(source_path: str) -> str:
    posix = PurePosixPath(source_path)
    if posix.name.lower() == "readme.md":
        parent = posix.parent.as_posix()
        return f"{ONLINE_BASE_URL}/" if parent == "." else f"{ONLINE_BASE_URL}/{parent}/"
    if posix.suffix.lower() == ".md":
        posix = posix.with_suffix(".html")
    return f"{ONLINE_BASE_URL}/{posix.as_posix()}"


def _terms(query: str) -> list[str]:
    return [term.casefold() for term in re.findall(r"[\w\u4e00-\u9fff]+", str(query or ""))]


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
