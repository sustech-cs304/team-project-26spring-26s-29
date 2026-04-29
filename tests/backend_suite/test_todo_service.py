"""Tests for the todo service layer."""

from backend.repositories.binding_repository import binding_repository
from backend.services import schedule_service, todo_service

from .support import BackendTestCase


class TodoServiceTests(BackendTestCase):
    def test_binding_lifecycle_tracks_due_todo_changes(self) -> None:
        todo = todo_service.create_todo(
            title="Submit lab",
            detail="initial draft",
            due_at="2026-04-20T11:00:00+00:00",
        )
        binding = binding_repository.get_binding_by_todo_id(todo.id)

        self.assertIsNotNone(binding)
        assert binding is not None
        created_schedule = schedule_service.get_schedule(binding.schedule_event_id)
        self.assertIsNotNone(created_schedule)
        assert created_schedule is not None
        self.assertEqual(created_schedule.title, "Submit lab")
        self.assertEqual(created_schedule.detail, "initial draft")
        self.assertEqual(created_schedule.start_at, "2026-04-20T11:00:00+00:00")
        self.assertEqual(created_schedule.end_at, "2026-04-20T11:30:00+00:00")

        todo_service.update_todo(
            todo.id,
            {
                "title": "Submit final lab",
                "detail": "ready to upload",
                "due_at": "2026-04-20T12:00:00+00:00",
                "is_done": True,
            },
        )
        synced_schedule = schedule_service.get_schedule(binding.schedule_event_id)
        self.assertIsNotNone(synced_schedule)
        assert synced_schedule is not None
        self.assertEqual(synced_schedule.title, "Submit final lab")
        self.assertEqual(synced_schedule.detail, "ready to upload")
        self.assertEqual(synced_schedule.start_at, "2026-04-20T12:00:00+00:00")
        self.assertEqual(synced_schedule.end_at, "2026-04-20T12:30:00+00:00")
        self.assertTrue(synced_schedule.is_done)

        todo_service.update_todo(todo.id, {"due_at": None})
        self.assertIsNone(binding_repository.get_binding_by_todo_id(todo.id))
        self.assertIsNone(schedule_service.get_schedule(binding.schedule_event_id))

    def test_deleting_todo_cleans_up_auto_bound_schedule(self) -> None:
        todo = todo_service.create_todo(
            title="Review slides",
            detail="final review",
            due_at="2026-04-20T09:00:00+00:00",
        )
        binding = binding_repository.get_binding_by_todo_id(todo.id)

        self.assertIsNotNone(binding)
        assert binding is not None

        deleted = todo_service.delete_todo(todo.id)

        self.assertTrue(deleted)
        self.assertIsNone(binding_repository.get_binding_by_todo_id(todo.id))
        self.assertIsNone(schedule_service.get_schedule(binding.schedule_event_id))

    def test_deleting_schedule_cleans_up_binding(self) -> None:
        todo = todo_service.create_todo(
            title="Attend demo",
            detail="project demo day",
            due_at="2026-04-21T10:00:00+00:00",
        )
        binding = binding_repository.get_binding_by_todo_id(todo.id)

        self.assertIsNotNone(binding)
        assert binding is not None

        deleted = schedule_service.delete_schedule(binding.schedule_event_id)

        self.assertTrue(deleted)
        self.assertIsNone(binding_repository.get_binding_by_todo_id(todo.id))
        self.assertIsNotNone(todo_service.get_todo(todo.id))

    def test_create_update_and_clear_completed_todos(self) -> None:
        first = todo_service.create_todo(title="Write report", detail="draft", due_at=None)
        second = todo_service.create_todo(
            title="Review slides",
            detail="final review",
            due_at="2026-04-20T09:00:00+08:00",
        )

        todo_service.update_todo(first.id, {"is_done": True})
        deleted_count = todo_service.clear_todos("completed")
        remaining = todo_service.list_todos()

        self.assertEqual(deleted_count, 1)
        self.assertEqual([todo.id for todo in remaining], [second.id])

    def test_clear_all_deletes_everything(self) -> None:
        todo_service.create_todo(title="Check email", detail="", due_at=None)
        due_todo = todo_service.create_todo(
            title="Review slides",
            detail="final review",
            due_at="2026-04-20T09:00:00+00:00",
        )
        binding = binding_repository.get_binding_by_todo_id(due_todo.id)
        self.assertIsNotNone(binding)
        assert binding is not None

        deleted_count = todo_service.clear_todos("all")

        self.assertEqual(deleted_count, 2)
        self.assertEqual(todo_service.list_todos(), [])
        self.assertEqual(schedule_service.list_schedules(), [])
        self.assertIsNone(binding_repository.get_binding_by_todo_id(due_todo.id))
