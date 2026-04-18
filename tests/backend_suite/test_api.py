"""HTTP tests for backend routes."""

from fastapi.testclient import TestClient

from backend.app import app
from backend.config import get_config, set_config

from .support import BackendTestCase


class ApiTests(BackendTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        super().tearDown()

    def test_todo_crud_routes(self) -> None:
        created = self.client.post(
            "/api/todos",
            json={"title": "Ship report", "detail": "backend refactor", "dueAt": None},
        )
        self.assertEqual(created.status_code, 201)
        todo_id = created.json()["id"]

        listed = self.client.get("/api/todos")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)

        patched = self.client.patch(f"/api/todos/{todo_id}", json={"isDone": True})
        self.assertEqual(patched.status_code, 200)
        self.assertTrue(patched.json()["isDone"])

        cleared = self.client.delete("/api/todos", params={"scope": "completed"})
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.json()["deletedCount"], 1)

    def test_todo_patch_rejects_explicit_null_fields(self) -> None:
        created = self.client.post(
            "/api/todos",
            json={"title": "Ship report", "detail": "backend refactor", "dueAt": None},
        )
        todo_id = created.json()["id"]

        patched = self.client.patch(f"/api/todos/{todo_id}", json={"title": None})
        self.assertEqual(patched.status_code, 422)

    def test_todo_patch_and_delete_missing_item_return_404(self) -> None:
        patched = self.client.patch("/api/todos/9999", json={"isDone": True})
        deleted = self.client.delete("/api/todos/9999")

        self.assertEqual(patched.status_code, 404)
        self.assertEqual(deleted.status_code, 404)

    def test_runtime_config_routes(self) -> None:
        current = self.client.get("/api/config")
        self.assertEqual(current.status_code, 200)
        self.assertEqual(current.json()["dbPath"], self.db_path)

        updated = self.client.post(
            "/api/config",
            json={
                "dbPath": self.db_path,
                "openaiApiKey": None,
                "openaiChatModel": "demo-model",
                "openaiEndpoint": None,
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["openaiChatModel"], "demo-model")

        set_config({**get_config(), "openaiChatModel": None})
