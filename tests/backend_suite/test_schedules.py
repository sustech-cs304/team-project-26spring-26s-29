"""Tests for the schedule service layer."""

from backend.services import schedule_service

from .support import BackendTestCase


class ScheduleServiceTests(BackendTestCase):
    def test_create_and_list_schedules(self) -> None:
        first = schedule_service.create_schedule(
            title="Lecture", detail="CS304 lecture", start_at="2026-04-20T09:00:00+08:00", end_at="2026-04-20T10:00:00+08:00"
        )

        second = schedule_service.create_schedule(
            title="Meeting", detail="Project meeting", start_at="2026-04-21T14:00:00+08:00", end_at="2026-04-21T15:00:00+08:00"
        )

        items = schedule_service.list_schedules()
        self.assertEqual([item.id for item in items], [first.id, second.id])

    def test_get_update_and_delete(self) -> None:
        created = schedule_service.create_schedule(
            title="Office hours", detail="Help", start_at="2026-04-22T16:00:00+08:00", end_at="2026-04-22T17:00:00+08:00"
        )

        loaded = schedule_service.get_schedule(created.id)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.title, "Office hours")

        schedule_service.update_schedule(created.id, title="Office Hours Updated")
        updated = schedule_service.get_schedule(created.id)
        self.assertEqual(updated.title, "Office Hours Updated")

        deleted = schedule_service.delete_schedule(created.id)
        self.assertTrue(deleted)
