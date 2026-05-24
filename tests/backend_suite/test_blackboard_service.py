from unittest.mock import patch

from backend.repositories import blackboard_repository
from backend.services.blackboard_service import (
    BlackboardAuthenticationError,
    BlackboardService,
    _normalize_datetime,
    _remote_record,
    _should_send_to_llm,
)

from .support import BackendTestCase


class FakeBlackboardClassifier:
    def classify(self, items, timestamp):
        records = []
        for item in items:
            due_at = _normalize_datetime(item.due_at) or "2999-06-07T23:59:00+08:00"
            records.append(
                {
                    "source_key": item.source_key,
                    "source_hash": item.raw_hash,
                    "source_type": item.source_type,
                    "course_id": item.course_id,
                    "course_name": item.course_name,
                    "action": "create_todo",
                    "status": "pending",
                    "title": f"{item.course_name}: {item.title}",
                    "detail": item.body_text,
                    "due_at": due_at,
                    "start_at": None,
                    "end_at": None,
                    "confidence": 0.9,
                    "reason": "Fake LLM classification",
                    "target_id": None,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                }
            )
        return records


class BlackboardServiceTests(BackendTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.service = BlackboardService(blackboard_repository, classifier=FakeBlackboardClassifier())

    def _upsert_and_classify(self, record, timestamp, summary) -> None:
        changed_items = []
        self.service._upsert_remote_item(record, summary, changed_items)
        summary["newSuggestions"] += self.service._create_suggestions_with_llm(changed_items, timestamp)

    def test_remote_item_hash_dedupes_suggestions(self) -> None:
        timestamp = "2026-05-24T00:00:00+00:00"
        summary = {"changedItems": 0, "newSuggestions": 0}
        record = _remote_record(
            source_type="gradebook_column",
            source_id="_1_1",
            course_id="_course_1",
            course_name="Software Engineering",
            title="Assignment 2",
            body_html="",
            url=None,
            created_at=None,
            modified_at=None,
            due_at="2026-06-07T15:59:00.000Z",
            raw_json={"id": "_1_1", "name": "Assignment 2", "grading": {"due": "2026-06-07T15:59:00.000Z"}},
            timestamp=timestamp,
        )

        self._upsert_and_classify(record, timestamp, summary)
        self._upsert_and_classify(record, timestamp, summary)

        suggestions = blackboard_repository.list_suggestions("pending")
        self.assertEqual(len(suggestions), 1)
        self.assertEqual(summary["changedItems"], 1)
        self.assertEqual(summary["newSuggestions"], 1)

    def test_changed_hash_creates_new_pending_suggestion_after_update(self) -> None:
        timestamp = "2026-05-24T00:00:00+00:00"
        summary = {"changedItems": 0, "newSuggestions": 0}
        first = _remote_record(
            source_type="content",
            source_id="_content_1",
            course_id="_course_1",
            course_name="AI",
            title="Quiz 1",
            body_html="Deadline June 7, 11:59pm",
            url=None,
            created_at=None,
            modified_at=None,
            due_at=None,
            raw_json={"id": "_content_1", "title": "Quiz 1", "body": "Deadline June 7, 11:59pm"},
            timestamp=timestamp,
        )
        second = _remote_record(
            source_type="content",
            source_id="_content_1",
            course_id="_course_1",
            course_name="AI",
            title="Quiz 1 updated",
            body_html="Deadline June 8, 11:59pm",
            url=None,
            created_at=None,
            modified_at=None,
            due_at=None,
            raw_json={"id": "_content_1", "title": "Quiz 1 updated", "body": "Deadline June 8, 11:59pm"},
            timestamp=timestamp,
        )

        self._upsert_and_classify(first, timestamp, summary)
        self._upsert_and_classify(second, timestamp, summary)

        suggestions = blackboard_repository.list_suggestions("pending")
        self.assertEqual(len(suggestions), 2)
        self.assertEqual(summary["changedItems"], 2)

    def test_apply_suggestion_creates_todo_and_marks_suggestion_applied(self) -> None:
        timestamp = "2026-05-24T00:00:00+00:00"
        summary = {"changedItems": 0, "newSuggestions": 0}
        record = _remote_record(
            source_type="gradebook_column",
            source_id="_2_1",
            course_id="_course_1",
            course_name="Software Engineering",
            title="Open Source PR",
            body_html="",
            url=None,
            created_at=None,
            modified_at=None,
            due_at="2026-05-30T12:00:00.000Z",
            raw_json={"id": "_2_1", "name": "Open Source PR", "grading": {"due": "2026-05-30T12:00:00.000Z"}},
            timestamp=timestamp,
        )
        self._upsert_and_classify(record, timestamp, summary)
        suggestion = blackboard_repository.list_suggestions("pending")[0]

        result = self.service.apply_suggestions([suggestion.id])
        applied = blackboard_repository.list_suggestions("applied")[0]

        self.assertEqual(result["appliedCount"], 1)
        self.assertIsNotNone(applied.target_id)
        self.assertEqual(applied.status, "applied")

    def test_expired_items_are_not_sent_to_llm(self) -> None:
        timestamp = "2026-05-24T00:00:00+00:00"
        expired = _remote_record(
            source_type="gradebook_column",
            source_id="_expired",
            course_id="_course_1",
            course_name="Software Engineering",
            title="Expired homework",
            body_html="",
            url=None,
            created_at=None,
            modified_at=None,
            due_at="2000-01-01T00:00:00.000Z",
            raw_json={"id": "_expired", "name": "Expired homework", "grading": {"due": "2000-01-01T00:00:00.000Z"}},
            timestamp=timestamp,
        )
        future = _remote_record(
            source_type="gradebook_column",
            source_id="_future",
            course_id="_course_1",
            course_name="Software Engineering",
            title="Future homework",
            body_html="",
            url=None,
            created_at=None,
            modified_at=None,
            due_at="2999-01-01T00:00:00.000Z",
            raw_json={"id": "_future", "name": "Future homework", "grading": {"due": "2999-01-01T00:00:00.000Z"}},
            timestamp=timestamp,
        )
        expired_item, _ = blackboard_repository.upsert_remote_item(expired)
        future_item, _ = blackboard_repository.upsert_remote_item(future)

        self.assertFalse(_should_send_to_llm(expired_item))
        self.assertTrue(_should_send_to_llm(future_item))

    def test_sync_maps_unauthenticated_response_to_needs_login(self) -> None:
        class FakeClient:
            def __init__(self, _cookie_header: str | None = None) -> None:
                pass

            def get_json(self, _path: str) -> dict:
                raise BlackboardAuthenticationError("expired")

        self.service._cookie_header = "s_session_id=expired"
        with patch("backend.services.blackboard_service.BlackboardApiClient", FakeClient):
            state = self.service.sync()

        self.assertFalse(state["connected"])
        self.assertTrue(state["needs_login"])

    def test_login_uses_fetched_cookies_and_refreshes_state(self) -> None:
        fake_cookies = [
            type("Cookie", (), {"name": "s_session_id", "value": "abc", "domain": "bb.sustech.edu.cn", "path": "/"})()
        ]

        with patch("backend.services.blackboard_service._login_blackboard", return_value=fake_cookies), patch.object(
            self.service,
            "refresh_status",
            return_value={"connected": True, "needs_login": False, "last_error": None},
        ) as refresh_status:
            state = self.service.login("student", "secret")

        refresh_status.assert_called_once()
        self.assertTrue(state["connected"])
        self.assertIn("s_session_id=abc", self.service._cookie_header)
