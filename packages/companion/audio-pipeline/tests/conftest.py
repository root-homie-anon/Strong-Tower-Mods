from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Generator
from pathlib import Path

import httpx
import pytest

SIDECAR_PORT = 4999
CLOUD_PORT = 8080

REPO_ROOT = Path(__file__).resolve().parents[4]
CLOUD_DIST = REPO_ROOT / 'packages' / 'shared' / 'api' / 'companion' / 'dist' / 'server.js'
SIDECAR_PKG = Path(__file__).resolve().parents[1]


def _wait_for_port(url: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            httpx.get(url, timeout=1.0)
            return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError(f'Service at {url} did not come up within {timeout}s')


@pytest.fixture(scope='session')
def cloud_process() -> Generator[subprocess.Popen[bytes], None, None]:
    proc = subprocess.Popen(
        ['node', str(CLOUD_DIST)],
        env={**__import__('os').environ, 'CLOUD_PORT': str(CLOUD_PORT)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_for_port(f'http://127.0.0.1:{CLOUD_PORT}/health')
        yield proc
    finally:
        proc.terminate()
        proc.wait(timeout=5)


@pytest.fixture(scope='session')
def sidecar_process(cloud_process: subprocess.Popen[bytes]) -> Generator[subprocess.Popen[bytes], None, None]:
    python = sys.executable
    proc = subprocess.Popen(
        [python, '-m', 'audio_pipeline.main'],
        cwd=str(SIDECAR_PKG),
        env={
            **__import__('os').environ,
            'SIDECAR_PORT': str(SIDECAR_PORT),
            'CLOUD_WS_URL': f'ws://127.0.0.1:{CLOUD_PORT}/companion/turn',
            'PYTHONPATH': str(SIDECAR_PKG / 'src'),
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_for_port(f'http://127.0.0.1:{SIDECAR_PORT}/health')
        yield proc
    finally:
        proc.terminate()
        proc.wait(timeout=5)
