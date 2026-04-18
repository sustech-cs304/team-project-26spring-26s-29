"""Shared backend test helpers."""

from __future__ import annotations

import os
import tempfile
import unittest

from backend.config import get_config, set_config


class TempDbMixin:
    """Provides a temporary TinyDB path for each test case."""

    db_path: str
    _original_config: dict[str, str | None]

    def setup_temp_db(self) -> None:
        self._original_config = get_config()
        file_descriptor, path = tempfile.mkstemp(suffix=".json")
        os.close(file_descriptor)
        os.unlink(path)
        self.db_path = path
        set_config({**self._original_config, "dbPath": self.db_path})

    def teardown_temp_db(self) -> None:
        set_config(self._original_config)
        if os.path.exists(self.db_path):
            os.remove(self.db_path)


class BackendTestCase(TempDbMixin, unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.setup_temp_db()

    def tearDown(self) -> None:
        self.teardown_temp_db()
        super().tearDown()


class AsyncBackendTestCase(TempDbMixin, unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.setup_temp_db()

    def tearDown(self) -> None:
        self.teardown_temp_db()
        super().tearDown()
