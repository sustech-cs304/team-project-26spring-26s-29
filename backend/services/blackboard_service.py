"""Blackboard Learn sync and suggestion service."""

from __future__ import annotations

import hashlib
import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from openai import OpenAI
from bs4 import BeautifulSoup

requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]

from ..config import get_config
from ..repositories import blackboard_repository
from ..repositories.blackboard_repository import (
    BlackboardRepository,
    BlackboardRemoteItemRecord,
    BlackboardSuggestion,
    BlackboardSuggestionRecord,
)
from .schedule_service import schedule_service
from .todo_service import todo_service


BLACKBOARD_BASE_URL = "https://bb.sustech.edu.cn"
CAS_BASE_URL = "https://cas.sustech.edu.cn/cas"
BLACKBOARD_LOGIN_SERVICE_URL = f"{BLACKBOARD_BASE_URL}/webapps/calendar/viewPersonal"
COMMON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0"
    ),
    "X-Requested-With": "XMLHttpRequest",
}
HONG_KONG_TZ = timezone(timedelta(hours=8))
MAX_CONTENT_DEPTH = 3
BLACKBOARD_COOKIE_NAMES = {
    "s_session_id",
    "JSESSIONID",
    "BbClientCalenderTimeZone",
    "web_client_cache_guid",
    "COOKIE_CONSENT_ACCEPTED",
}


class BlackboardAuthenticationError(RuntimeError):
    """Raised when Blackboard rejects the current session."""


class BlackboardClassificationError(RuntimeError):
    """Raised when Blackboard suggestion classification fails."""


@dataclass(frozen=True, slots=True)
class BlackboardCookie:
    name: str
    value: str
    domain: str | None = None
    path: str | None = None


class BlackboardApiClient:
    def __init__(self, cookie_header: str | None = None) -> None:
        self.cookie_header = cookie_header

    def get_json(self, path: str) -> dict[str, Any]:
        url = path if path.startswith("http") else f"{BLACKBOARD_BASE_URL}{path}"
        headers = {"Accept": "application/json"}
        if self.cookie_header:
            headers["Cookie"] = self.cookie_header

        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise BlackboardAuthenticationError("Blackboard session is not authenticated.") from exc
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Blackboard API returned {exc.code}: {detail}") from exc

    def get_paged_results(self, path: str) -> list[dict[str, Any]]:
        payload = self.get_json(path)
        results = list(payload.get("results") or [])
        next_page = _extract_next_page(payload)
        while next_page:
            payload = self.get_json(next_page)
            results.extend(payload.get("results") or [])
            next_page = _extract_next_page(payload)
        return results


def _build_cas_login_url(service_url: str) -> str:
    return f"{CAS_BASE_URL}/login?service={urllib.parse.quote(service_url, safe='')}"


def _extract_execution_token(html_text: str) -> str:
    match = re.search(r'name="execution" value="([^"]+)"', html_text)
    if not match:
        raise BlackboardAuthenticationError("Unable to parse CAS login token.")
    return match.group(1)


def _cookies_from_session(session: requests.Session) -> list[BlackboardCookie]:
    cookies: list[BlackboardCookie] = []
    for cookie in session.cookies:
      if cookie.name not in BLACKBOARD_COOKIE_NAMES:
        continue
      cookies.append(
          BlackboardCookie(
              name=cookie.name,
              value=cookie.value,
              domain=getattr(cookie, "domain", None),
              path=getattr(cookie, "path", None),
          )
      )
    return cookies


def _login_blackboard(username: str, password: str) -> list[BlackboardCookie]:
    session = requests.Session()
    session.headers.update(COMMON_HEADERS)

    login_url = _build_cas_login_url(BLACKBOARD_LOGIN_SERVICE_URL)
    page = session.get(login_url, verify=False, timeout=20)
    page.raise_for_status()

    response = session.post(
        login_url,
        data={
            "username": username,
            "password": password,
            "execution": _extract_execution_token(page.text),
            "_eventId": "submit",
            "geolocation": "",
        },
        allow_redirects=True,
        verify=False,
        timeout=20,
    )
    response.raise_for_status()

    warmup = session.get(
        BLACKBOARD_LOGIN_SERVICE_URL,
        headers={**COMMON_HEADERS, "Referer": BLACKBOARD_LOGIN_SERVICE_URL},
        allow_redirects=True,
        verify=False,
        timeout=20,
    )
    warmup.raise_for_status()

    return _cookies_from_session(session)


class BlackboardLlmClassifier:
    def classify(self, items: list[Any], timestamp: str) -> list[BlackboardSuggestionRecord]:
        candidates = [_candidate_for_llm(item) for item in items if _should_send_to_llm(item)]
        if not candidates:
            return []

        config = get_config()
        api_key = config.get("openaiApiKey")
        model = config.get("openaiChatModel")
        endpoint = config.get("openaiEndpoint")
        if not api_key or not model:
            raise BlackboardClassificationError("OpenAI API key and chat model are required for Blackboard classification.")

        client_options = {"api_key": api_key}
        if endpoint:
            client_options["base_url"] = endpoint
        client = OpenAI(**client_options)
        response = client.chat.completions.create(
            model=model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You classify Blackboard items into personal todos and schedule events. "
                        "Return JSON only. Do not invent dates. If an item is only an informational notice, ignore it. "
                        "Use create_todo for deadlines and submissions. Use create_schedule for fixed-time events "
                        "the student must attend, such as exams, presentations, meetings, or lab checks."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "timezone": "Asia/Hong_Kong",
                            "now": timestamp,
                            "schema": {
                                "suggestions": [
                                    {
                                        "source_key": "string",
                                        "action": "create_todo | create_schedule | ignore",
                                        "title": "short user-facing title",
                                        "detail": "brief source-aware explanation",
                                        "due_at": "ISO datetime or null",
                                        "start_at": "ISO datetime or null",
                                        "end_at": "ISO datetime or null",
                                        "confidence": "0.0-1.0",
                                        "reason": "brief reason",
                                    }
                                ]
                            },
                            "items": candidates,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or "{}"
        payload = json.loads(content)
        suggestions = payload.get("suggestions") or []
        records: list[BlackboardSuggestionRecord] = []
        items_by_key = {item.source_key: item for item in items}
        for suggestion in suggestions:
            source_key = str(suggestion.get("source_key") or "")
            item = items_by_key.get(source_key)
            if item is None:
                continue
            action = str(suggestion.get("action") or "ignore")
            if action not in {"create_todo", "create_schedule", "ignore"}:
                action = "ignore"
            if action == "ignore":
                continue
            due_at = _normalize_datetime(suggestion.get("due_at")) if suggestion.get("due_at") else None
            start_at = _normalize_datetime(suggestion.get("start_at")) if suggestion.get("start_at") else None
            end_at = _normalize_datetime(suggestion.get("end_at")) if suggestion.get("end_at") else None
            if action == "create_todo" and due_at is None:
                continue
            if action == "create_schedule" and start_at is None:
                continue
            if action == "create_schedule" and end_at is None:
                end_at = _add_one_hour(start_at)
            if _is_past_datetime(due_at or start_at):
                continue
            records.append(
                {
                    "source_key": item.source_key,
                    "source_hash": item.raw_hash,
                    "source_type": item.source_type,
                    "course_id": item.course_id,
                    "course_name": item.course_name,
                    "action": action,  # type: ignore[typeddict-item]
                    "status": "pending",
                    "title": str(suggestion.get("title") or _suggestion_title(item)).strip()[:240],
                    "detail": str(suggestion.get("detail") or _suggestion_detail(item)).strip()[:4000],
                    "due_at": due_at if action == "create_todo" else None,
                    "start_at": start_at if action == "create_schedule" else None,
                    "end_at": end_at if action == "create_schedule" else None,
                    "confidence": _coerce_confidence(suggestion.get("confidence")),
                    "reason": str(suggestion.get("reason") or "Classified by LLM").strip()[:500],
                    "target_id": None,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                }
            )
        return records


class BlackboardService:
    def __init__(
        self,
        repository: BlackboardRepository = blackboard_repository,
        classifier: BlackboardLlmClassifier | None = None,
    ) -> None:
        self._repository = repository
        self._classifier = classifier or BlackboardLlmClassifier()
        self._cookie_header: str | None = None
        self._session_cookies: list[BlackboardCookie] = []

    def set_session(self, cookies: list[BlackboardCookie]) -> dict[str, Any]:
        self._cookie_header = _build_cookie_header(cookies)
        self._session_cookies = list(cookies)
        return self.refresh_status()

    def login(self, username: str, password: str) -> dict[str, Any]:
        username = username.strip()
        password = password.strip()
        if not username or not password:
            return self._repository.update_state(
                {
                    "connected": False,
                    "needs_login": True,
                    "user": None,
                    "learn_version": None,
                    "last_error": "Blackboard username and password are required.",
                }
            )

        try:
            cookies = _login_blackboard(username, password)
            if not cookies:
                raise BlackboardAuthenticationError("Blackboard login did not return any session cookies.")
        except Exception as exc:
            self._cookie_header = None
            self._session_cookies = []
            return self._repository.update_state(
                {
                    "connected": False,
                    "needs_login": True,
                    "user": None,
                    "learn_version": None,
                    "last_error": f"Blackboard login failed: {exc}",
                }
            )

        return self.set_session(cookies)

    def clear_session(self) -> dict[str, Any]:
        self._cookie_header = None
        self._session_cookies = []
        return self._repository.update_state(
            {
                "connected": False,
                "needs_login": True,
                "user": None,
                "learn_version": None,
                "last_error": None,
            }
        )

    def get_status(self) -> dict[str, Any]:
        state = self._repository.get_state()
        state["has_session"] = self._cookie_header is not None
        return state

    def refresh_status(self) -> dict[str, Any]:
        if not self._cookie_header:
            return self.clear_session()

        client = BlackboardApiClient(self._cookie_header)
        try:
            user = client.get_json("/learn/api/public/v1/users/me")
            version = client.get_json("/learn/api/public/v1/system/version")
        except BlackboardAuthenticationError:
            self._cookie_header = None
            self._session_cookies = []
            return self._repository.update_state(
                {
                    "connected": False,
                    "needs_login": True,
                    "user": None,
                    "last_error": "Blackboard session expired. Please sign in again.",
                }
            )

        return self._repository.update_state(
            {
                "connected": True,
                "needs_login": False,
                "user": _safe_user(user),
                "learn_version": version.get("learn"),
                "last_error": None,
            }
        )

    def sync(self) -> dict[str, Any]:
        if not self._cookie_header:
            state = self.clear_session()
            state["last_error"] = "Blackboard login is required."
            return state

        client = BlackboardApiClient(self._cookie_header)
        timestamp = _utcnow_iso()
        summary = {
            "courses": 0,
            "announcements": 0,
            "contentItems": 0,
            "gradebookColumns": 0,
            "changedItems": 0,
            "newSuggestions": 0,
        }
        seen_keys: set[str] = set()
        changed_items: list[Any] = []

        try:
            user = client.get_json("/learn/api/public/v1/users/me")
            version = client.get_json("/learn/api/public/v1/system/version")
            enrollments = client.get_paged_results("/learn/api/public/v1/users/me/courses")
            course_ids = [
                item["courseId"]
                for item in enrollments
                if item.get("availability", {}).get("available") != "No"
            ]
            courses = {course_id: client.get_json(f"/learn/api/public/v1/courses/{_quote(course_id)}") for course_id in course_ids}
        except BlackboardAuthenticationError:
            self._cookie_header = None
            self._session_cookies = []
            return self._repository.update_state(
                {
                    "connected": False,
                    "needs_login": True,
                    "last_error": "Blackboard session expired. Please sign in again.",
                }
            )

        summary["courses"] = len(courses)

        for course_id, course in courses.items():
            course_name = str(course.get("name") or course_id)
            try:
                summary["announcements"] += self._sync_announcements(client, course_id, course_name, timestamp, seen_keys, summary, changed_items)
                summary["contentItems"] += self._sync_contents(client, course_id, course_name, timestamp, seen_keys, summary, changed_items)
                summary["gradebookColumns"] += self._sync_gradebook(client, course_id, course_name, timestamp, seen_keys, summary, changed_items)
            except BlackboardAuthenticationError:
                return self._repository.update_state(
                    {
                        "connected": False,
                        "needs_login": True,
                        "last_error": "Blackboard session expired. Please sign in again.",
                    }
                )
            except Exception:
                continue

        self._repository.mark_missing_items(seen_keys, timestamp)
        try:
            summary["newSuggestions"] += self._create_suggestions_with_llm(changed_items, timestamp)
            last_error = None
        except BlackboardClassificationError as exc:
            last_error = str(exc)
        except Exception as exc:
            last_error = f"Blackboard LLM classification failed: {exc}"
        return self._repository.update_state(
            {
                "connected": True,
                "needs_login": False,
                "user": _safe_user(user),
                "learn_version": version.get("learn"),
                "last_sync_at": timestamp,
                "last_summary": summary,
                "last_error": last_error,
            }
        )

    def list_suggestions(self, status: str | None = "pending") -> list[BlackboardSuggestion]:
        normalized_status = None if status in {None, "all"} else status
        return self._repository.list_suggestions(normalized_status)  # type: ignore[arg-type]

    def apply_suggestions(self, ids: list[int]) -> dict[str, Any]:
        applied: list[BlackboardSuggestion] = []
        for suggestion in self._repository.list_suggestions("pending"):
            if suggestion.id not in ids:
                continue

            if suggestion.action == "create_todo":
                todo = todo_service.create_todo(
                    title=suggestion.title,
                    detail=suggestion.detail,
                    due_at=suggestion.due_at,
                )
                applied.append(self._repository.update_suggestion(suggestion.id, {"status": "applied", "target_id": todo.id}))
            elif suggestion.action == "create_schedule":
                event = schedule_service.create_schedule(
                    title=suggestion.title,
                    detail=suggestion.detail,
                    start_at=suggestion.start_at or suggestion.due_at or _utcnow_iso(),
                    end_at=suggestion.end_at or _add_one_hour(suggestion.start_at or suggestion.due_at or _utcnow_iso()),
                    all_day=False,
                    timezone_name="Asia/Hong_Kong",
                    location=None,
                )
                applied.append(self._repository.update_suggestion(suggestion.id, {"status": "applied", "target_id": event.id}))
            else:
                applied.append(self._repository.update_suggestion(suggestion.id, {"status": "dismissed"}))

        return {"appliedCount": len(applied), "suggestions": applied}

    def get_session_cookies(self) -> list[BlackboardCookie]:
        return list(self._session_cookies)

    def dismiss_suggestions(self, ids: list[int]) -> dict[str, Any]:
        dismissed = [
            self._repository.update_suggestion(suggestion.id, {"status": "dismissed"})
            for suggestion in self._repository.list_suggestions("pending")
            if suggestion.id in ids
        ]
        return {"dismissedCount": len(dismissed), "suggestions": dismissed}

    def _sync_announcements(
        self,
        client: BlackboardApiClient,
        course_id: str,
        course_name: str,
        timestamp: str,
        seen_keys: set[str],
        summary: dict[str, int],
        changed_items: list[Any],
    ) -> int:
        announcements = client.get_paged_results(f"/learn/api/public/v1/announcements?courseId={_quote(course_id)}")
        for announcement in announcements:
            source_id = str(announcement.get("id") or "")
            if not source_id:
                continue
            record = _remote_record(
                source_type="announcement",
                source_id=source_id,
                course_id=course_id,
                course_name=course_name,
                title=str(announcement.get("title") or "Announcement"),
                body_html=str(announcement.get("body") or ""),
                url=_alternate_url(announcement),
                created_at=announcement.get("created"),
                modified_at=announcement.get("modified"),
                due_at=None,
                raw_json=announcement,
                timestamp=timestamp,
            )
            self._upsert_remote_item(record, summary, changed_items)
            seen_keys.add(record["source_key"])
        return len(announcements)

    def _sync_contents(
        self,
        client: BlackboardApiClient,
        course_id: str,
        course_name: str,
        timestamp: str,
        seen_keys: set[str],
        summary: dict[str, int],
        changed_items: list[Any],
    ) -> int:
        roots = client.get_paged_results(f"/learn/api/public/v1/courses/{_quote(course_id)}/contents")
        all_contents: list[dict[str, Any]] = []
        for content in roots:
            all_contents.extend(self._walk_content(client, course_id, content, 0))

        for content in all_contents:
            source_id = str(content.get("id") or "")
            if not source_id:
                continue
            body_html = str(content.get("body") or content.get("description") or "")
            record = _remote_record(
                source_type="content",
                source_id=source_id,
                course_id=course_id,
                course_name=course_name,
                title=str(content.get("title") or "Course content"),
                body_html=body_html,
                url=_alternate_url(content),
                created_at=content.get("created"),
                modified_at=content.get("modified"),
                due_at=_content_due(content),
                raw_json=content,
                timestamp=timestamp,
            )
            self._upsert_remote_item(record, summary, changed_items)
            seen_keys.add(record["source_key"])
        return len(all_contents)

    def _walk_content(
        self,
        client: BlackboardApiClient,
        course_id: str,
        content: dict[str, Any],
        depth: int,
    ) -> list[dict[str, Any]]:
        items = [content]
        content_id = str(content.get("id") or "")
        if depth >= MAX_CONTENT_DEPTH or not content.get("hasChildren") or not content_id:
            return items
        children = client.get_paged_results(
            f"/learn/api/public/v1/courses/{_quote(course_id)}/contents/{_quote(content_id)}/children"
        )
        for child in children:
            items.extend(self._walk_content(client, course_id, child, depth + 1))
        return items

    def _sync_gradebook(
        self,
        client: BlackboardApiClient,
        course_id: str,
        course_name: str,
        timestamp: str,
        seen_keys: set[str],
        summary: dict[str, int],
        changed_items: list[Any],
    ) -> int:
        columns = client.get_paged_results(f"/learn/api/public/v1/courses/{_quote(course_id)}/gradebook/columns")
        for column in columns:
            source_id = str(column.get("id") or "")
            if not source_id:
                continue
            due_at = column.get("grading", {}).get("due")
            record = _remote_record(
                source_type="gradebook_column",
                source_id=source_id,
                course_id=course_id,
                course_name=course_name,
                title=str(column.get("name") or "Gradebook item"),
                body_html=str(column.get("description") or ""),
                url=None,
                created_at=None,
                modified_at=None,
                due_at=due_at,
                raw_json=column,
                timestamp=timestamp,
            )
            self._upsert_remote_item(record, summary, changed_items)
            seen_keys.add(record["source_key"])
        return len(columns)

    def _upsert_remote_item(
        self,
        record: BlackboardRemoteItemRecord,
        summary: dict[str, int],
        changed_items: list[Any],
    ) -> None:
        item, changed = self._repository.upsert_remote_item(record)
        if not changed:
            return
        summary["changedItems"] += 1
        changed_items.append(item)

    def _create_suggestions_with_llm(self, items: list[Any], timestamp: str) -> int:
        records = self._classifier.classify(items, timestamp)
        created = 0
        for record in records:
            existing = self._repository.find_suggestion(
                record["source_key"],
                record["source_hash"],
                record["action"],
                record["title"],
            )
            if existing is not None:
                continue
            self._repository.add_suggestion(record)
            created += 1
        return created


def _extract_next_page(payload: dict[str, Any]) -> str | None:
    next_page = payload.get("paging", {}).get("nextPage")
    if not next_page:
        return None
    return str(next_page)


def _build_cookie_header(cookies: list[BlackboardCookie]) -> str | None:
    pairs = []
    for cookie in cookies:
        if cookie.domain and "bb.sustech.edu.cn" not in cookie.domain:
            continue
        if cookie.name not in {"s_session_id", "JSESSIONID", "BbClientCalenderTimeZone", "web_client_cache_guid", "COOKIE_CONSENT_ACCEPTED"}:
            continue
        if not cookie.value:
            continue
        pairs.append(f"{cookie.name}={cookie.value}")
    return "; ".join(pairs) or None


def _remote_record(
    *,
    source_type: str,
    source_id: str,
    course_id: str | None,
    course_name: str | None,
    title: str,
    body_html: str,
    url: str | None,
    created_at: str | None,
    modified_at: str | None,
    due_at: str | None,
    raw_json: dict[str, Any],
    timestamp: str,
) -> BlackboardRemoteItemRecord:
    body_text = _html_to_text(body_html)
    source_key = f"{source_type}:{course_id or 'global'}:{source_id}"
    raw_hash = _hash_json(raw_json)
    return {
        "source_key": source_key,
        "source_type": source_type,
        "source_id": source_id,
        "course_id": course_id,
        "course_name": course_name,
        "title": title.strip()[:500],
        "body_text": body_text[:8000],
        "url": url,
        "created_at": created_at,
        "modified_at": modified_at,
        "due_at": due_at,
        "raw_hash": raw_hash,
        "raw_json": raw_json,
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "missing_count": 0,
        "deleted_at": None,
    }


def _candidate_for_llm(item: Any) -> dict[str, Any]:
    return {
        "source_key": item.source_key,
        "source_type": item.source_type,
        "course_id": item.course_id,
        "course_name": item.course_name,
        "title": item.title,
        "body_text": item.body_text[:3000],
        "structured_due_at": _normalize_datetime(item.due_at),
        "text_datetime_hint": _extract_datetime_from_text(f"{item.title}\n{item.body_text}"),
        "url": item.url,
        "created_at": item.created_at,
        "modified_at": item.modified_at,
    }


def _should_send_to_llm(item: Any) -> bool:
    candidate_time = _candidate_datetime(item)
    if candidate_time:
        return not _is_past_datetime(candidate_time)
    if item.source_type == "gradebook_column":
        return False
    return _looks_actionable(item.title, item.body_text)


def _candidate_datetime(item: Any) -> str | None:
    return _normalize_datetime(item.due_at) or _extract_datetime_from_text(f"{item.title}\n{item.body_text}")


def _suggestion_title(item: Any) -> str:
    course = f"{item.course_name}: " if item.course_name else ""
    return f"{course}{item.title}".strip()[:240]


def _suggestion_detail(item: Any) -> str:
    parts = [
        f"Source: {item.source_type}",
        f"Course: {item.course_name or item.course_id or 'Unknown'}",
    ]
    if item.url:
        parts.append(f"URL: {item.url}")
    if item.body_text:
        parts.append("")
        parts.append(item.body_text[:2500])
    return "\n".join(parts)


def _looks_actionable(title: str, body: str) -> bool:
    text = f"{title} {body}".lower()
    terms = (
        "deadline",
        "due",
        "assignment",
        "homework",
        "作业",
        "submit",
        "submission",
        "quiz",
        "project",
        "exam",
        "考试",
        "presentation",
        "答辩",
        "meeting",
        "lab check",
        "检查",
    )
    return any(term in text for term in terms)


def _content_due(content: dict[str, Any]) -> str | None:
    for key in ("due", "dueDate", "end"):
        value = content.get(key)
        if isinstance(value, str):
            return value
    for value in content.values():
        if isinstance(value, dict):
            for key in ("due", "dueDate"):
                nested = value.get(key)
                if isinstance(nested, str):
                    return nested
    return None


def _html_to_text(value: str) -> str:
    if not value:
        return ""
    text = BeautifulSoup(value, "html.parser").get_text(" ")
    return html.unescape(re.sub(r"\s+", " ", text)).strip()


def _hash_json(value: dict[str, Any]) -> str:
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _alternate_url(value: dict[str, Any]) -> str | None:
    for link in value.get("links") or []:
        if link.get("rel") == "alternate" and link.get("href"):
            href = str(link["href"])
            return href if href.startswith("http") else f"{BLACKBOARD_BASE_URL}{href}"
    return None


def _safe_user(user: dict[str, Any]) -> dict[str, Any]:
    name = user.get("name") or {}
    return {
        "id": user.get("id"),
        "userName": user.get("userName"),
        "displayName": " ".join(str(name.get(key) or "") for key in ("family", "given")).strip(),
    }


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_datetime(value: Any) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(HONG_KONG_TZ).isoformat()


def _is_past_datetime(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.astimezone(HONG_KONG_TZ) <= datetime.now(HONG_KONG_TZ)


def _coerce_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.75
    return max(0.0, min(1.0, confidence))


def _extract_datetime_from_text(text: str) -> str | None:
    patterns = [
        r"(?P<month>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?(?:,\s*(?P<year>\d{4}))?(?:[^0-9]{0,30}(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>am|pm|AM|PM)?)?",
        r"(?P<year>\d{4})[-/](?P<month_num>\d{1,2})[-/](?P<day>\d{1,2})(?:\s+(?P<hour>\d{1,2}):(?P<minute>\d{2}))?",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        groups = match.groupdict()
        year = int(groups.get("year") or datetime.now(HONG_KONG_TZ).year)
        month = int(groups["month_num"]) if groups.get("month_num") else _month_number(str(groups.get("month") or ""))
        day = int(groups["day"])
        hour = int(groups.get("hour") or 23)
        minute = int(groups.get("minute") or 59)
        ampm = groups.get("ampm")
        if ampm:
            normalized = ampm.lower()
            if normalized == "pm" and hour < 12:
                hour += 12
            if normalized == "am" and hour == 12:
                hour = 0
        try:
            return datetime(year, month, day, hour, minute, tzinfo=HONG_KONG_TZ).isoformat()
        except ValueError:
            continue
    return None


def _month_number(value: str) -> int:
    month = value[:3].lower()
    months = {
        "jan": 1,
        "feb": 2,
        "mar": 3,
        "apr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "aug": 8,
        "sep": 9,
        "oct": 10,
        "nov": 11,
        "dec": 12,
    }
    return months.get(month, 1)


def _add_one_hour(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (parsed + timedelta(hours=1)).isoformat()


blackboard_service = BlackboardService()
