"""Tests for the generated SUSTech manual corpus."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from backend.services.sustech_manual_service import (
    fetch_sustech_manual_online,
    read_sustech_manual_record,
    search_sustech_manual,
)
from tools.build_sustech_manual_corpus import (
    CorpusError,
    SourceGitMetadata,
    build_corpus,
    validate_corpus,
)

from .support import BackendTestCase


class SUSTechManualCorpusTests(BackendTestCase):
    def test_build_generates_mirrored_markdown_pdf_manifest_and_index(self) -> None:
        with tempfile.TemporaryDirectory() as source_dir, tempfile.TemporaryDirectory() as output_dir:
            source_root = Path(source_dir)
            output_root = Path(output_dir)
            (source_root / "calendar").mkdir()
            (source_root / "calendar" / "README.md").write_text(
                "# 校历\n\n2025-2026 学年校历正文。",
                encoding="utf-8",
            )
            (source_root / "transport").mkdir()
            (source_root / "transport" / "bus.pdf").write_bytes(_simple_pdf_bytes("Campus Bus Fixture"))

            build_corpus(source_root, output_root, git_metadata=_metadata())

            markdown_record = output_root / "generated" / "calendar" / "README.md.json"
            pdf_record = output_root / "generated" / "transport" / "bus.pdf.json"
            self.assertTrue(markdown_record.exists())
            self.assertTrue(pdf_record.exists())

            markdown_data = json.loads(markdown_record.read_text(encoding="utf-8"))
            pdf_data = json.loads(pdf_record.read_text(encoding="utf-8"))
            manifest = json.loads((output_root / "manifest.json").read_text(encoding="utf-8"))
            index = json.loads((output_root / "index.json").read_text(encoding="utf-8"))

            self.assertEqual(markdown_data["source_commit"], "abc123")
            self.assertEqual(markdown_data["source_commit_time"], "2026-05-01T12:00:00+00:00")
            self.assertIn("2025-2026 学年校历正文", markdown_data["text"])
            self.assertIn("Campus Bus Fixture", pdf_data["text"])
            self.assertEqual(manifest["source_commit"], "abc123")
            self.assertEqual(manifest["source_commit_time"], "2026-05-01T12:00:00+00:00")
            self.assertEqual(manifest["source_commit_time_unix"], 1777636800)
            self.assertEqual(manifest["document_count"], 2)
            self.assertEqual(index["source_commit"], "abc123")
            self.assertEqual(index["source_commit_time"], "2026-05-01T12:00:00+00:00")
            self.assertEqual(len(index["records"]), 2)

    def test_validate_fails_on_missing_or_incomplete_corpus(self) -> None:
        with tempfile.TemporaryDirectory() as output_dir:
            with self.assertRaises(CorpusError):
                validate_corpus(Path(output_dir))

            output_root = Path(output_dir)
            (output_root / "generated").mkdir()
            (output_root / "manifest.json").write_text(
                json.dumps({"schema_version": 1, "source_commit": "abc123"}),
                encoding="utf-8",
            )
            (output_root / "index.json").write_text(
                json.dumps({"schema_version": 1, "records": []}),
                encoding="utf-8",
            )

            with self.assertRaises(CorpusError):
                validate_corpus(output_root)

    def test_service_search_and_read_include_source_commit_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as source_dir, tempfile.TemporaryDirectory() as output_dir:
            source_root = Path(source_dir)
            output_root = Path(output_dir)
            (source_root / "life").mkdir()
            (source_root / "life" / "README.md").write_text(
                "# 校园生活\n\n饭堂营业时间示例。",
                encoding="utf-8",
            )
            build_corpus(source_root, output_root, git_metadata=_metadata())

            search_result = search_sustech_manual("饭堂", corpus_root=output_root)
            self.assertTrue(search_result["ok"])
            self.assertEqual(search_result["source_commit"], "abc123")
            self.assertEqual(search_result["source_commit_time"], "2026-05-01T12:00:00+00:00")
            self.assertEqual(len(search_result["matches"]), 1)

            record_id = search_result["matches"][0]["record_id"]
            read_result = read_sustech_manual_record(record_id, corpus_root=output_root)
            self.assertTrue(read_result["ok"])
            self.assertEqual(read_result["source_commit"], "abc123")
            self.assertIn("饭堂营业时间示例", read_result["record"]["text"])

    def test_online_fetch_rejects_unsafe_source_paths(self) -> None:
        with tempfile.TemporaryDirectory() as output_dir:
            output_root = Path(output_dir)
            output_root.mkdir(exist_ok=True)
            (output_root / "manifest.json").write_text(
                json.dumps(
                    {
                        "source_commit": "abc123",
                        "source_commit_time": "2026-05-01T12:00:00+00:00",
                    }
                ),
                encoding="utf-8",
            )

            for unsafe in ("../secret.md", "/absolute.md", "https://example.com/x.md"):
                with self.assertRaises(ValueError):
                    fetch_sustech_manual_online(unsafe, corpus_root=output_root)


def _metadata() -> SourceGitMetadata:
    return SourceGitMetadata(
        source_commit="abc123",
        source_commit_time="2026-05-01T12:00:00+00:00",
        source_commit_time_unix=1777636800,
        source_branch="main",
        source_dirty=False,
    )


def _simple_pdf_bytes(text: str) -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET".encode("ascii")
    objects.append(b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream")

    body = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(body))
        body.extend(f"{index} 0 obj\n".encode("ascii"))
        body.extend(obj)
        body.extend(b"\nendobj\n")

    xref_offset = len(body)
    body.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    body.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        body.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    body.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return bytes(body)
