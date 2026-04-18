"""Shared TinyDB storage helpers."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from tinydb import TinyDB
from tinydb.table import Table

from ...config import get_config


_DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "db" / "db.json"


def get_database_path(db_path: str | Path | None = None) -> Path:
    resolved = db_path
    if resolved is None:
        resolved = get_config().get("dbPath")

    if resolved is None:
        return _DEFAULT_DB_PATH

    return Path(resolved).expanduser().resolve()


@contextmanager
def open_table(table_name: str, db_path: str | Path | None = None) -> Iterator[Table]:
    database_path = get_database_path(db_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    database = TinyDB(str(database_path))
    table = database.table(table_name)

    try:
        yield table
    finally:
        database.close()
