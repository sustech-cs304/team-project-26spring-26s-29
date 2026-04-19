import sys
from pathlib import Path

# Ensure project root is on sys.path so `backend` package can be imported
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.api.app import create_app
from fastapi.testclient import TestClient

app = create_app()
client = TestClient(app, raise_server_exceptions=True)

payload = {
    "title": "测试创建",
    "detail": "由复现脚本创建",
    "startAt": "2026-04-19T10:00:00Z",
    "endAt": "2026-04-19T11:00:00Z",
    "allDay": False,
    "timezone": "UTC",
    "location": None,
    "reminderOffsets": [],
    "recurrence": None,
    "recurrenceEnd": None,
}

resp = client.post('/api/schedules', json=payload)
print('STATUS:', resp.status_code)
try:
    print(resp.json())
except Exception:
    print(resp.text)
