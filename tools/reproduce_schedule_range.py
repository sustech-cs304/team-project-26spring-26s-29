import os
import sys
import traceback
from pathlib import Path

# Ensure repository root is on sys.path so `backend` package is importable
repo_root = str(Path(__file__).resolve().parent.parent)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from backend.api.app import create_app
from fastapi.testclient import TestClient


def main():
    app = create_app()
    client = TestClient(app, raise_server_exceptions=True)
    try:
        resp = client.get('/api/schedules/range?start=2026-04-01T00:00:00Z&end=2026-05-01T00:00:00Z')
        print('STATUS:', resp.status_code)
        print(resp.text)
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
