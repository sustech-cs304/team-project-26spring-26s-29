"""Build a deterministic local text corpus from the SUSTech manual submodule."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.services.document_service import (  # noqa: E402
    DOCUMENT_TEXT_MAX_CHARACTERS,
    SUPPORTED_DOCUMENT_EXTENSIONS,
    extract_document_text,
)

SCHEMA_VERSION = 1
SOURCE_REPO = "https://github.com/SUSTech-CRA/sustech-online-ng"
ONLINE_BASE_URL = "https://sustech.online"
LICENSE = "CC-BY-SA-4.0"
DEFAULT_SOURCE_ROOT = REPO_ROOT / "vendor" / "sustech-online-ng" / "docs"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "backend" / "knowledge" / "sustech_manual"
SKIP_FILE_RE = re.compile(r"^google[a-z0-9]+\.html$", re.IGNORECASE)
SKIP_DIR_NAMES = {".vuepress", "node_modules", ".git"}
SUPPORTED_EXTENSIONS = set(SUPPORTED_DOCUMENT_EXTENSIONS)
REQUIRED_MANIFEST_KEYS = {
    "schema_version",
    "source_repo",
    "source_commit",
    "source_commit_time",
    "source_commit_time_unix",
    "source_branch",
    "source_dirty",
    "source_docs_root",
    "license",
    "extractors",
    "document_count",
}
REQUIRED_RECORD_KEYS = {
    "record_id",
    "source_path",
    "source_commit",
    "source_commit_time",
    "source_file_hash",
    "title",
    "text",
    "text_hash",
    "extractor",
    "extraction_error",
    "online_url",
    "license",
}


@dataclass(frozen=True)
class SourceGitMetadata:
    source_commit: str
    source_commit_time: str
    source_commit_time_unix: int
    source_branch: str | None
    source_dirty: bool


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument(
        "--paths",
        nargs="*",
        default=None,
        help="Optional docs-relative paths to rebuild. Omitted paths mean a full rebuild.",
    )
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    try:
        if args.validate_only:
            validate_corpus(args.output_root)
            return 0
        build_corpus(args.source_root, args.output_root, paths=args.paths)
        return 0
    except CorpusError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


class CorpusError(RuntimeError):
    """Raised when corpus build or validation cannot continue."""


def build_corpus(
    source_root: Path = DEFAULT_SOURCE_ROOT,
    output_root: Path = DEFAULT_OUTPUT_ROOT,
    *,
    paths: list[str] | None = None,
    git_metadata: SourceGitMetadata | None = None,
) -> dict[str, Any]:
    source_root = source_root.resolve()
    output_root = output_root.resolve()
    generated_root = output_root / "generated"

    if not source_root.exists():
        raise CorpusError(
            f"SUSTech manual docs root not found: {source_root}. "
            "Run `git submodule update --init --recursive` first."
        )
    if not source_root.is_dir():
        raise CorpusError(f"SUSTech manual docs root is not a directory: {source_root}")

    metadata = git_metadata or read_source_git_metadata(source_root)
    source_files = discover_source_files(source_root, paths=paths)

    if paths is None:
        if generated_root.exists():
            shutil.rmtree(generated_root)
        generated_root.mkdir(parents=True, exist_ok=True)
    else:
        generated_root.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    for source_file in source_files:
        record = build_record(source_root, source_file, metadata)
        if not record["text"] and not record["extraction_error"]:
            continue
        write_json(record_output_path(generated_root, record["source_path"]), record)
        records.append(record)

    if paths is not None:
        records = read_all_generated_records(generated_root)

    index = build_index(records, metadata)
    manifest = build_manifest(source_root, metadata, document_count=len(records))

    output_root.mkdir(parents=True, exist_ok=True)
    write_json(output_root / "manifest.json", manifest)
    write_json(output_root / "index.json", index)
    validate_corpus(output_root)
    return manifest


def read_source_git_metadata(source_root: Path) -> SourceGitMetadata:
    git_root = source_root.parent
    source_commit = git(git_root, "rev-parse", "HEAD")
    source_commit_time = git(git_root, "show", "-s", "--format=%cI", "HEAD")
    source_commit_time_unix = int(git(git_root, "show", "-s", "--format=%ct", "HEAD"))

    try:
        source_branch = git(git_root, "symbolic-ref", "--short", "HEAD")
    except CorpusError:
        source_branch = None

    source_dirty = bool(git(git_root, "status", "--porcelain"))
    return SourceGitMetadata(
        source_commit=source_commit,
        source_commit_time=source_commit_time,
        source_commit_time_unix=source_commit_time_unix,
        source_branch=source_branch,
        source_dirty=source_dirty,
    )


def git(cwd: Path, *args: str) -> str:
    try:
        completed = subprocess.run(
            ["git", "-C", str(cwd), *args],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CorpusError(f"Git command failed in {cwd}: git {' '.join(args)}") from exc
    return completed.stdout.strip()


def discover_source_files(source_root: Path, *, paths: list[str] | None = None) -> list[Path]:
    if paths is None:
        candidates = (path for path in source_root.rglob("*") if path.is_file())
    else:
        candidates = []
        resolved: list[Path] = []
        for raw_path in paths:
            source_path = normalize_source_path(raw_path)
            absolute_path = (source_root / Path(*PurePosixPath(source_path).parts)).resolve()
            ensure_inside(source_root, absolute_path)
            if absolute_path.exists() and absolute_path.is_file():
                resolved.append(absolute_path)
        candidates = resolved

    return sorted(path for path in candidates if should_extract(path, source_root))


def should_extract(path: Path, source_root: Path) -> bool:
    try:
        relative = path.relative_to(source_root)
    except ValueError:
        return False

    if any(part in SKIP_DIR_NAMES for part in relative.parts):
        return False
    if SKIP_FILE_RE.match(path.name):
        return False
    return path.suffix.lower() in SUPPORTED_EXTENSIONS


def build_record(source_root: Path, source_file: Path, metadata: SourceGitMetadata) -> dict[str, Any]:
    source_path = to_posix_relative(source_file, source_root)
    file_bytes = source_file.read_bytes()
    source_file_hash = sha256_bytes(file_bytes)
    extraction = extract_document_text(
        source_file,
        max_characters=DOCUMENT_TEXT_MAX_CHARACTERS,
    )
    text = extraction.text if extraction.readable else ""
    extraction_error = "" if extraction.readable else extraction.message
    if extraction.warnings:
        extraction_error = "\n".join([extraction_error, *extraction.warnings]).strip()

    title = extract_title(text, source_file)
    return {
        "schema_version": SCHEMA_VERSION,
        "record_id": stable_id("record", source_path, source_file_hash[:16]),
        "source_path": source_path,
        "source_commit": metadata.source_commit,
        "source_commit_time": metadata.source_commit_time,
        "source_file_hash": source_file_hash,
        "title": title,
        "text": text,
        "text_hash": sha256_text(text),
        "extractor": extractor_name(source_file),
        "extraction_error": extraction_error,
        "online_url": online_url_for_source_path(source_path),
        "license": LICENSE,
        "page_or_sheet_count": extraction.page_or_sheet_count,
        "truncated": extraction.truncated,
    }


def build_manifest(
    source_root: Path,
    metadata: SourceGitMetadata,
    *,
    document_count: int,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "source_repo": SOURCE_REPO,
        "source_commit": metadata.source_commit,
        "source_commit_time": metadata.source_commit_time,
        "source_commit_time_unix": metadata.source_commit_time_unix,
        "source_branch": metadata.source_branch,
        "source_dirty": metadata.source_dirty,
        "source_docs_root": str(source_root),
        "license": LICENSE,
        "extractors": {
            "document_service": "backend.services.document_service.extract_document_text",
            "max_characters": DOCUMENT_TEXT_MAX_CHARACTERS,
            "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
        },
        "document_count": document_count,
        "build_generated_at": datetime.now(timezone.utc).isoformat(),
    }


def build_index(records: list[dict[str, Any]], metadata: SourceGitMetadata) -> dict[str, Any]:
    entries = []
    for record in sorted(records, key=lambda item: item["source_path"]):
        text = record.get("text") or ""
        entries.append(
            {
                "record_id": record["record_id"],
                "source_path": record["source_path"],
                "generated_path": str(record_output_relative_path(record["source_path"])).replace("\\", "/"),
                "title": record["title"],
                "preview": text[:500],
                "search_text": normalize_search_text(
                    " ".join(
                        [
                            record["title"],
                            record["source_path"],
                            text[:5000],
                            record.get("extraction_error") or "",
                        ]
                    )
                ),
                "online_url": record["online_url"],
                "source_commit": metadata.source_commit,
                "source_commit_time": metadata.source_commit_time,
                "license": LICENSE,
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "source_commit": metadata.source_commit,
        "source_commit_time": metadata.source_commit_time,
        "records": entries,
    }


def validate_corpus(output_root: Path = DEFAULT_OUTPUT_ROOT) -> None:
    output_root = output_root.resolve()
    manifest_path = output_root / "manifest.json"
    index_path = output_root / "index.json"
    generated_root = output_root / "generated"

    if not manifest_path.exists():
        raise CorpusError("SUSTech manual corpus manifest is missing. Run `npm run build:sustech-manual`.")
    if not index_path.exists():
        raise CorpusError("SUSTech manual search index is missing. Run `npm run build:sustech-manual`.")
    if not generated_root.exists():
        raise CorpusError("SUSTech manual generated records are missing. Run `npm run build:sustech-manual`.")

    manifest = read_json(manifest_path)
    missing_manifest = sorted(REQUIRED_MANIFEST_KEYS - set(manifest))
    if missing_manifest:
        raise CorpusError(f"manifest.json is missing required fields: {', '.join(missing_manifest)}")
    if not manifest["source_commit"] or not manifest["source_commit_time"]:
        raise CorpusError("manifest.json must include non-empty source commit and source commit time.")
    if not isinstance(manifest["source_commit_time_unix"], int):
        raise CorpusError("manifest.json source_commit_time_unix must be an integer.")
    if not isinstance(manifest["source_dirty"], bool):
        raise CorpusError("manifest.json source_dirty must be a boolean.")
    if os.environ.get("CI") and manifest["source_dirty"]:
        raise CorpusError("CI requires a clean SUSTech manual submodule; manifest source_dirty is true.")

    index = read_json(index_path)
    records = index.get("records")
    if not isinstance(records, list) or not records:
        raise CorpusError("index.json must contain a non-empty records array.")
    if index.get("source_commit") != manifest["source_commit"]:
        raise CorpusError("index.json source_commit does not match manifest.json.")
    if index.get("source_commit_time") != manifest["source_commit_time"]:
        raise CorpusError("index.json source_commit_time does not match manifest.json.")

    generated_files = list(generated_root.rglob("*.json"))
    if not generated_files:
        raise CorpusError("generated/ contains no record JSON files.")

    record_ids = set()
    for entry in records:
        if not entry.get("source_commit") or not entry.get("source_commit_time"):
            raise CorpusError("index entry is missing source_commit or source_commit_time.")
        if entry["source_commit"] != manifest["source_commit"]:
            raise CorpusError("index entry source_commit does not match manifest.json.")
        if entry["source_commit_time"] != manifest["source_commit_time"]:
            raise CorpusError("index entry source_commit_time does not match manifest.json.")
        record_ids.add(entry.get("record_id"))

    for record_path in generated_files:
        record = read_json(record_path)
        missing_record = sorted(REQUIRED_RECORD_KEYS - set(record))
        if missing_record:
            raise CorpusError(f"{record_path} is missing required fields: {', '.join(missing_record)}")
        if record["record_id"] not in record_ids:
            raise CorpusError(f"{record_path} record_id is not listed in index.json.")
        if record["source_commit"] != manifest["source_commit"]:
            raise CorpusError(f"{record_path} source_commit does not match manifest.json.")
        if record["source_commit_time"] != manifest["source_commit_time"]:
            raise CorpusError(f"{record_path} source_commit_time does not match manifest.json.")

    if manifest["document_count"] != len(generated_files):
        raise CorpusError("manifest.json document_count does not match generated record count.")


def read_all_generated_records(generated_root: Path) -> list[dict[str, Any]]:
    return [read_json(path) for path in sorted(generated_root.rglob("*.json"))]


def record_output_path(generated_root: Path, source_path: str) -> Path:
    return generated_root / record_output_relative_path(source_path)


def record_output_relative_path(source_path: str) -> Path:
    posix = PurePosixPath(source_path)
    return Path(*posix.parts).with_name(f"{posix.name}.json")


def normalize_source_path(value: str) -> str:
    candidate = str(value or "").strip().replace("\\", "/")
    if not candidate or candidate.startswith("/") or "://" in candidate:
        raise CorpusError(f"Invalid source path: {value!r}")
    normalized = PurePosixPath(candidate)
    if any(part == ".." for part in normalized.parts):
        raise CorpusError(f"Invalid source path outside docs root: {value!r}")
    return normalized.as_posix()


def ensure_inside(root: Path, path: Path) -> None:
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise CorpusError(f"Path escapes docs root: {path}") from exc


def to_posix_relative(path: Path, root: Path) -> str:
    return PurePosixPath(path.relative_to(root).as_posix()).as_posix()


def online_url_for_source_path(source_path: str) -> str:
    posix = PurePosixPath(source_path)
    if posix.name.lower() == "readme.md":
        parent = posix.parent.as_posix()
        return f"{ONLINE_BASE_URL}/" if parent == "." else f"{ONLINE_BASE_URL}/{parent}/"
    if posix.suffix.lower() == ".md":
        posix = posix.with_suffix(".html")
    return f"{ONLINE_BASE_URL}/{posix.as_posix()}"


def extract_title(text: str, path: Path) -> str:
    if text:
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                title = stripped.lstrip("#").strip()
                if title:
                    return title
            if stripped:
                return stripped[:80]
    if path.name.lower() == "readme.md":
        return path.parent.name or "README"
    return path.stem


def extractor_name(path: Path) -> str:
    suffix = path.suffix.lower().lstrip(".") or "unknown"
    return f"document_service:{suffix}"


def stable_id(*parts: str) -> str:
    digest = sha256_text("\0".join(parts))[:16]
    return f"{parts[0]}_{digest}"


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize_search_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).casefold().strip()


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
