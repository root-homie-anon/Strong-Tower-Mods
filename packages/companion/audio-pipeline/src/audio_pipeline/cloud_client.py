from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

from .errors import CloudAuthError, CloudConnectionError, CloudValidationError, TurnRequestError

logger = logging.getLogger(__name__)

CLOUD_WS_URL = os.environ.get('CLOUD_WS_URL', 'ws://127.0.0.1:8080/companion/turn')
# In production the sidecar will hold a real JWT minted at session open. For development the
# cloud stub accepts any non-empty bearer token. Override via CLOUD_DEV_TOKEN env var.
_DEV_TOKEN = os.environ.get('CLOUD_DEV_TOKEN', 'dev-token')

_connection: ClientConnection | None = None
_connection_lock = asyncio.Lock()
_pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
_receiver_task: asyncio.Task[None] | None = None


async def _receive_loop(conn: ClientConnection) -> None:
    try:
        async for raw in conn:
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError:
                continue

            error_code = frame.get('error')

            if error_code == 'AUTH_ERROR':
                # Cloud rejected our JWT. Retrying will not help — cancel all pending futures immediately
                # so callers surface a meaningful error instead of timing out after 10 seconds.
                msg = frame.get('message', 'Cloud rejected authentication')
                logger.warning('Cloud AUTH_ERROR: %s — cancelling %d pending futures', msg, len(_pending))
                exc = CloudAuthError(msg)
                for fut in _pending.values():
                    if not fut.done():
                        fut.set_exception(exc)
                _pending.clear()
                return  # Do not reconnect — auth won't improve by retrying.

            if error_code == 'VALIDATION_ERROR':
                # This is a sidecar bug: we sent a frame the cloud rejected as invalid.
                msg = frame.get('message', 'Cloud rejected turn.request as invalid')
                logger.warning('Cloud VALIDATION_ERROR: %s', msg)
                exc = CloudValidationError(msg)
                seq = frame.get('seq')
                if seq is not None and seq in _pending:
                    fut = _pending.pop(seq)
                    if not fut.done():
                        fut.set_exception(exc)
                else:
                    # No seq on the error frame — fail every pending future.
                    for fut in _pending.values():
                        if not fut.done():
                            fut.set_exception(exc)
                    _pending.clear()
                continue

            # Normal turn.response frame — route by seq.
            seq = frame.get('seq')
            if seq is not None and seq in _pending:
                fut = _pending.pop(seq)
                if not fut.done():
                    fut.set_result(frame)

    except Exception:
        for fut in _pending.values():
            if not fut.done():
                fut.cancel()
        _pending.clear()


async def _get_connection() -> ClientConnection:
    global _connection, _receiver_task

    async with _connection_lock:
        if _connection is not None:
            try:
                await _connection.ping()
                return _connection
            except Exception:
                _connection = None
                if _receiver_task is not None:
                    _receiver_task.cancel()
                    _receiver_task = None

        try:
            conn = await websockets.connect(
                CLOUD_WS_URL,
                additional_headers={'Authorization': f'Bearer {_DEV_TOKEN}'},
                open_timeout=5,
            )
        except OSError as exc:
            raise CloudConnectionError(f'Cannot reach cloud at {CLOUD_WS_URL}: {exc}') from exc
        except Exception as exc:
            raise CloudConnectionError(f'WS connect failed: {exc}') from exc

        _connection = conn
        _receiver_task = asyncio.get_event_loop().create_task(_receive_loop(conn))
        return conn


async def request_turn(
    session_id: str,
    seq: int,
    trigger: str,
    game_state: dict[str, Any],
    memory_recall: list[Any],
    history: list[Any],
) -> dict[str, Any]:
    frame = {
        'type': 'turn.request',
        'seq': seq,
        'sessionId': session_id,
        'trigger': trigger,
        'playerInput': None,
        'characterContext': None,
        'gameState': game_state,
        'memoryRecall': memory_recall,
        'history': history,
    }

    try:
        conn = await _get_connection()
    except CloudConnectionError:
        raise

    loop = asyncio.get_event_loop()
    fut: asyncio.Future[dict[str, Any]] = loop.create_future()
    _pending[seq] = fut

    try:
        await conn.send(json.dumps(frame))
    except Exception as exc:
        _pending.pop(seq, None)
        raise CloudConnectionError(f'Failed to send turn.request frame: {exc}') from exc

    try:
        response = await asyncio.wait_for(fut, timeout=10.0)
    except asyncio.TimeoutError as exc:
        _pending.pop(seq, None)
        raise CloudConnectionError(f'Cloud did not respond to seq={seq} within 10s') from exc

    if response.get('type') != 'turn.response':
        raise TurnRequestError(f'Unexpected frame type from cloud: {response.get("type")}')

    return response
