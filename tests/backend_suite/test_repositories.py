"""Repository integration tests."""

from backend.repositories.tinydb.schedule_repository import TinyDbScheduleRepository
from backend.repositories.tinydb.todo_repository import TinyDbTodoRepository

from .support import BackendTestCase


class TinyDbRepositoryTests(BackendTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.todo_repository = TinyDbTodoRepository()
        self.schedule_repository = TinyDbScheduleRepository()

    def test_todo_repository_round_trip(self) -> None:
        created = self.todo_repository.add_todo(
            "Prepare lab",
            "bring laptop",
            due_at=None,
            db_path=self.db_path,
        )
        updated = self.todo_repository.update_todo(created.id, {"detail": "bring laptop and notes", "is_done": True}, self.db_path)
        listed = self.todo_repository.list_todos(db_path=self.db_path)

        self.assertTrue(updated.is_done)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0].detail, "bring laptop and notes")

    def test_schedule_repository_range_query(self) -> None:
        created = self.schedule_repository.add_schedule_event(
            "Project demo",
            "team sync",
            "2026-04-21T10:00:00+08:00",
            "2026-04-21T11:00:00+08:00",
            db_path=self.db_path,
        )

        events = self.schedule_repository.list_schedule_events_in_range(
            "2026-04-21T00:00:00+08:00",
            "2026-04-22T00:00:00+08:00",
            db_path=self.db_path,
        )

        self.assertEqual([event.id for event in events], [created.id])
