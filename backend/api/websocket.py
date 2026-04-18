"""Utilities for backend WebSocket responses."""

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState


async def close_websocket(websocket: WebSocket) -> None:
    if websocket.client_state == WebSocketState.DISCONNECTED:
        return
    if websocket.application_state == WebSocketState.DISCONNECTED:
        return
    await websocket.close()


async def send_websocket_json(websocket: WebSocket, payload: dict[str, str]) -> None:
    if websocket.client_state == WebSocketState.DISCONNECTED:
        raise WebSocketDisconnect()
    if websocket.application_state == WebSocketState.DISCONNECTED:
        raise WebSocketDisconnect()

    try:
        await websocket.send_json(payload)
    except RuntimeError as exc:
        raise WebSocketDisconnect() from exc
