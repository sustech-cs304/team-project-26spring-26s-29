"""HTTP tests for backend routes."""

from unittest.mock import patch

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

    def test_agent_run_post_accepts_structured_contents(self) -> None:
        async def fake_run_prompt(contents):
            self.assertEqual(contents[0]["type"], "image")
            self.assertEqual(contents[1]["type"], "text")
            return {
                "role": "assistant",
                "status": "completed",
                "contents": [{"type": "text", "text": "Looks good."}],
            }

        with patch("backend.api.routes.agent.run_prompt", side_effect=fake_run_prompt):
            response = self.client.post(
                "/api/agent/run",
                json={
                    "contents": [
                        {
                            "type": "image",
                            "name": "diagram.png",
                            "mediaType": "image/png",
                            "dataBase64": "YWJj",
                        },
                        {"type": "text", "text": "Please inspect this image."},
                    ]
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message"]["contents"][0]["text"], "Looks good.")

    def test_agent_run_post_rejects_empty_contents(self) -> None:
        response = self.client.post("/api/agent/run", json={"contents": []})
        self.assertEqual(response.status_code, 422)

    def test_agent_run_websocket_handles_approval_round_trip(self) -> None:
        class FakeController:
            def __init__(self) -> None:
                self.approvals = []

            async def start(self, contents, on_update):
                self.contents = contents
                await on_update(
                    {
                        "role": "assistant",
                        "status": "running",
                        "contents": [{"type": "text", "text": "Checking..."}],
                    }
                )
                return {
                    "role": "assistant",
                    "status": "needs_approval",
                    "contents": [
                        {
                            "type": "function_approval_request",
                            "approvalId": "approval-1",
                            "decision": "pending",
                            "functionCall": {
                                "type": "function_call",
                                "callId": "call-1",
                                "name": "create_todo",
                                "arguments": {"title": "Ship report"},
                                "argumentsText": "{\n  \"title\": \"Ship report\"\n}",
                            },
                        }
                    ],
                }

            async def respond_to_approval(self, approval_id, approved, on_update):
                self.approvals.append((approval_id, approved))
                await on_update(
                    {
                        "role": "assistant",
                        "status": "running",
                        "contents": [{"type": "text", "text": "Applying..."}],
                    }
                )
                return {
                    "role": "assistant",
                    "status": "completed",
                    "contents": [{"type": "text", "text": "Done."}],
                }

        fake_controller = FakeController()

        with patch("backend.api.routes.agent.create_run", return_value=fake_controller):
            with self.client.websocket_connect("/api/agent/run") as websocket:
                websocket.send_json(
                    {
                        "type": "run",
                        "requestId": "req-1",
                        "contents": [{"type": "text", "text": "Create a todo"}],
                    }
                )

                first_event = websocket.receive_json()
                second_event = websocket.receive_json()

                self.assertEqual(first_event["type"], "update")
                self.assertEqual(first_event["message"]["contents"][0]["text"], "Checking...")
                self.assertEqual(second_event["message"]["status"], "needs_approval")

                websocket.send_json(
                    {
                        "type": "approval_response",
                        "requestId": "req-1",
                        "approvalId": "approval-1",
                        "approved": True,
                    }
                )

                third_event = websocket.receive_json()
                fourth_event = websocket.receive_json()

                self.assertEqual(third_event["type"], "update")
                self.assertEqual(third_event["message"]["contents"][0]["text"], "Applying...")
                self.assertEqual(fourth_event["type"], "done")
                self.assertEqual(fourth_event["message"]["contents"][0]["text"], "Done.")
                self.assertEqual(fake_controller.approvals, [("approval-1", True)])
