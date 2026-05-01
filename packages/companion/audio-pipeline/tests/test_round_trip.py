from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from collections.abc import Generator
from pathlib import Path

import httpx
import pytest
import websockets

SIDECAR_PKG = Path(__file__).resolve().parents[1]
_BAD_AUTH_SIDECAR_PORT = 4998

SIDECAR_PORT = 4999
CLOUD_PORT = 8080
CLOUD_WS_URL = f'ws://127.0.0.1:{CLOUD_PORT}/companion/turn'

CANONICAL_PAYLOAD = {
    'sessionId': 'dev-session-001',
    'seq': 1,
    'trigger': 'player_greeted',
    'gameState': {'location': 'Sanctuary Hills', 'combat': {'inCombat': False}},
    'memoryRecall': [],
    'history': [],
}


def test_cloud_health(cloud_process: subprocess.Popen[bytes]) -> None:
    response = httpx.get(f'http://127.0.0.1:{CLOUD_PORT}/health')
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'ok'
    assert body['service'] == 'companion-api'


def test_sidecar_health(sidecar_process: subprocess.Popen[bytes]) -> None:
    response = httpx.get(f'http://127.0.0.1:{SIDECAR_PORT}/health')
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'ok'
    assert body['service'] == 'companion-sidecar'


def test_round_trip_contract(sidecar_process: subprocess.Popen[bytes]) -> None:
    response = httpx.post(
        f'http://127.0.0.1:{SIDECAR_PORT}/turn/request',
        json=CANONICAL_PAYLOAD,
        timeout=10.0,
    )
    assert response.status_code == 200, f'Unexpected status {response.status_code}: {response.text}'

    body = response.json()

    assert body['source'] == 'cloud-stub', f'Expected source=cloud-stub, got: {body.get("source")}'
    assert body['sessionId'] == 'dev-session-001'
    assert body['seq'] == 1
    assert isinstance(body['audioPath'], str)
    assert isinstance(body['lipPath'], str)
    assert body['morphSeq'] == []
    assert body['durationMs'] == 0
    assert isinstance(body['responseText'], str) and len(body['responseText']) > 0
    assert isinstance(body['sentiment'], str) and len(body['sentiment']) > 0


def test_missing_auth_on_cloud_direct_ws(cloud_process: subprocess.Popen[bytes]) -> None:
    """Cloud WS endpoint closes the connection with an AUTH_ERROR frame when no bearer token is sent."""

    async def _run() -> dict[str, object]:
        async with websockets.connect(CLOUD_WS_URL) as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            return json.loads(raw)  # type: ignore[return-value]

    frame = asyncio.run(_run())
    assert frame.get('error') == 'AUTH_ERROR', f'Expected AUTH_ERROR, got: {frame}'


def test_cloud_rejects_missing_fields_over_ws(cloud_process: subprocess.Popen[bytes]) -> None:
    """Cloud WS endpoint returns a VALIDATION_ERROR frame when required fields are absent."""

    async def _run() -> dict[str, object]:
        async with websockets.connect(
            CLOUD_WS_URL,
            additional_headers={'Authorization': 'Bearer dev-token'},
        ) as ws:
            await ws.send(json.dumps({'type': 'turn.request', 'sessionId': 'x'}))
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            return json.loads(raw)  # type: ignore[return-value]

    frame = asyncio.run(_run())
    assert frame.get('error') == 'VALIDATION_ERROR', f'Expected VALIDATION_ERROR, got: {frame}'


@pytest.fixture()
def bad_auth_sidecar_process(
    cloud_process: subprocess.Popen[bytes],
) -> Generator[subprocess.Popen[bytes], None, None]:
    """Sidecar started with an empty CLOUD_DEV_TOKEN so the cloud will reject it with AUTH_ERROR.

    Invokes uvicorn directly on audio_pipeline.server:app (bypassing main.py's lockfile guard)
    so this fixture can run alongside the session-scoped sidecar_process without conflicting.
    """
    python = sys.executable
    proc = subprocess.Popen(
        [
            python,
            '-c',
            (
                'import uvicorn; '
                'from audio_pipeline.server import app; '
                f'uvicorn.run(app, host="127.0.0.1", port={_BAD_AUTH_SIDECAR_PORT}, log_level="warning")'
            ),
        ],
        cwd=str(SIDECAR_PKG),
        env={
            **__import__('os').environ,
            'SIDECAR_PORT': str(_BAD_AUTH_SIDECAR_PORT),
            'CLOUD_WS_URL': f'ws://127.0.0.1:{CLOUD_PORT}/companion/turn',
            'CLOUD_DEV_TOKEN': '',  # Empty token — cloud will send AUTH_ERROR immediately.
            'PYTHONPATH': str(SIDECAR_PKG / 'src'),
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        # Wait for the sidecar HTTP server to be ready (not the WS connection — that's lazy).
        deadline = __import__('time').monotonic() + 10.0
        while __import__('time').monotonic() < deadline:
            try:
                httpx.get(f'http://127.0.0.1:{_BAD_AUTH_SIDECAR_PORT}/health', timeout=1.0)
                break
            except Exception:
                __import__('time').sleep(0.2)
        yield proc
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def test_auth_error_surfaces_promptly_to_sidecar_caller(
    bad_auth_sidecar_process: subprocess.Popen[bytes],
) -> None:
    """F2 regression: cloud AUTH_ERROR must surface as a 5xx within 2 seconds, not a 10s timeout.

    The cloud sends {error: AUTH_ERROR} with no seq when it rejects the bearer token.
    Before the fix _receive_loop silently dropped this frame and the caller waited the
    full 10-second asyncio.wait_for timeout before getting a generic CloudConnectionError.
    After the fix CloudAuthError is set on all pending futures immediately.
    """
    response = httpx.post(
        f'http://127.0.0.1:{_BAD_AUTH_SIDECAR_PORT}/turn/request',
        json={
            'sessionId': 'dev-session-001',
            'seq': 1,
            'trigger': 'player_greeted',
            'gameState': {},
            'memoryRecall': [],
            'history': [],
        },
        timeout=2.0,  # Must respond well within 2 seconds — NOT the 10s timeout.
    )
    assert response.status_code >= 500, (
        f'Expected 5xx from auth failure, got {response.status_code}: {response.text}'
    )
    body = response.json()
    assert 'error' in body, f'Expected error field in response body: {body}'
