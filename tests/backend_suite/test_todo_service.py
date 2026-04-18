"""Tests for the todo service layer."""

from backend.services import todo_query_service, todo_service

from .support import BackendTestCase


class TodoServiceTests(BackendTestCase):
    def test_create_update_and_clear_completed_todos(self) -> None:
        first = todo_service.create_todo(title="Write report", detail="draft", due_at=None)
        second = todo_service.create_todo(
            title="Review slides",
            detail="final review",
            due_at="2026-04-20T09:00:00+08:00",
        )

        todo_service.update_todo(first.id, {"is_done": True})
        snapshot = todo_query_service.build_runtime_snapshot("service-test")

        self.assertEqual(snapshot["todos"]["total"], 2)
        self.assertEqual(snapshot["todos"]["done"], 1)
        self.assertEqual(snapshot["todos"]["open"], 1)

        deleted_count = todo_service.clear_todos("completed")
        remaining = todo_service.list_todos()

        self.assertEqual(deleted_count, 1)
        self.assertEqual([todo.id for todo in remaining], [second.id])

    def test_snapshot_formatter_mentions_session_and_counts(self) -> None:
        todo_service.create_todo(title="Check email", detail="", due_at=None)
        snapshot = todo_query_service.build_runtime_snapshot("session-42")
        formatted = todo_query_service.format_runtime_snapshot(snapshot)

        self.assertIn("Session: session-42", formatted)
        self.assertIn("Todos:", formatted)
