"""Utilities for backend WebSocket responses."""

from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


async def close_websocket(websocket: WebSocket) -> None:
    try:
        await websocket.close()
    except RuntimeError:
        return


async def send_websocket_json(websocket: WebSocket, payload: dict[str, Any]) -> None:
    try:
        await websocket.send_json(payload)
    except RuntimeError as exc:
        raise WebSocketDisconnect() from exc
