from __future__ import annotations

import os
import subprocess
import sys
import tempfile
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

# Per-test-run output directory for synthesised audio so the WAV files
# the mock voice pipeline writes do not accumulate in ~/.local/share.
# Session-scoped: every fixture that spawns a sidecar points it here.
TEST_AUDIO_DIR = Path(tempfile.gettempdir()) / 'strong-tower-mods-test-audio'


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
        env={
            **os.environ,
            'CLOUD_PORT': str(CLOUD_PORT),
            'ANTHROPIC_MOCK': 'true',
            # The audio-pipeline tests pre-date the real JWT / billing
            # integration. AUTH_MOCK=true keeps the legacy "any bearer
            # accepted" path active so these fixtures stay independent of
            # @strong-tower/db state. New cloud-level tests that exercise
            # the real JWT path leave AUTH_MOCK unset.
            'AUTH_MOCK': 'true',
        },
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
            **os.environ,
            'SIDECAR_PORT': str(SIDECAR_PORT),
            'CLOUD_WS_URL': f'ws://127.0.0.1:{CLOUD_PORT}/companion/turn',
            'PYTHONPATH': str(SIDECAR_PKG / 'src'),
            'ELEVENLABS_MOCK': 'true',
            'AUDIO_OUTPUT_DIR': str(TEST_AUDIO_DIR),
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


@pytest.fixture(scope='session')
def cloud_process_live() -> Generator[subprocess.Popen[bytes], None, None]:
    """Cloud process fixture for smoke tests — uses real ANTHROPIC_API_KEY, no mock."""
    proc = subprocess.Popen(
        ['node', str(CLOUD_DIST)],
        env={
            **os.environ,
            'CLOUD_PORT': str(CLOUD_PORT),
            # ANTHROPIC_MOCK is intentionally absent so the real SDK is used.
            # ANTHROPIC_API_KEY must be set in the test runner's environment.
        },
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
def sidecar_process_live(
    cloud_process_live: subprocess.Popen[bytes],
) -> Generator[subprocess.Popen[bytes], None, None]:
    """Sidecar process fixture for smoke tests — paired with cloud_process_live."""
    python = sys.executable
    proc = subprocess.Popen(
        [python, '-m', 'audio_pipeline.main'],
        cwd=str(SIDECAR_PKG),
        env={
            **os.environ,
            'SIDECAR_PORT': str(SIDECAR_PORT),
            'CLOUD_WS_URL': f'ws://127.0.0.1:{CLOUD_PORT}/companion/turn',
            'PYTHONPATH': str(SIDECAR_PKG / 'src'),
            'ELEVENLABS_MOCK': 'true',
            'AUDIO_OUTPUT_DIR': str(TEST_AUDIO_DIR),
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
