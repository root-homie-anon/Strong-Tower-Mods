"""Mempalace memory module — in-process unit tests.

Covers the mock-mode contract (used by every other test in this
package) and the real-mode store path. Real-mode recall against a
freshly-created palace returns nothing useful (mempalace's miner has
not run), so that path is not asserted on here — it's exercised
manually before Nexus release.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from audio_pipeline import memory


# ---------------------------------------------------------------------------
# Mock mode — every existing test in this suite depends on this contract.
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('MEMORY_MOCK', 'true')


async def test_mock_recall_returns_empty(mock_mode: None) -> None:
    recall = await memory.recall(session_id='s', query='anything')
    assert isinstance(recall, memory.MemoryRecall)
    assert recall.items == []


async def test_mock_store_turn_writes_nothing(
    mock_mode: None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv('MEMORY_DIR', str(tmp_path))

    await memory.store_turn(
        session_id='s',
        player_input='hello',
        response_text='[mock response]',
        sentiment='warm',
        game_state={'location': 'Sanctuary'},
    )

    # No palace subdir, no log file — store_turn must be inert in mock mode
    # because the existing round-trip tests rely on no filesystem side effects.
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------------------
# Real mode — store_turn path (no mempalace recall assertion).
# ---------------------------------------------------------------------------


@pytest.fixture()
def real_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.delenv('MEMORY_MOCK', raising=False)
    monkeypatch.setenv('MEMORY_DIR', str(tmp_path))
    return tmp_path


async def test_store_turn_creates_palace_dir_and_appends_jsonl(real_mode: Path) -> None:
    await memory.store_turn(
        session_id='session-abc',
        player_input='What happened to the Castle?',
        response_text='[sentiment: melancholy]\nThe Castle is what survives. Briefly.',
        sentiment='melancholy',
        game_state={'location': 'The Castle', 'time': 'dusk'},
    )

    palace_dir = real_mode / 'session-abc'
    assert palace_dir.is_dir()

    log_path = palace_dir / 'conversation.jsonl'
    assert log_path.is_file()

    lines = log_path.read_text(encoding='utf-8').splitlines()
    assert len(lines) == 1

    record = json.loads(lines[0])
    assert record['sessionId'] == 'session-abc'
    assert record['playerInput'] == 'What happened to the Castle?'
    assert record['sentiment'] == 'melancholy'
    assert record['gameState']['location'] == 'The Castle'
    # The exact timestamp value is non-deterministic; just ensure the field
    # exists and is a float — mempalace's miner uses it for ordering.
    assert isinstance(record['timestamp'], float)


async def test_store_turn_appends_across_calls(real_mode: Path) -> None:
    for seq, text in enumerate(['first', 'second', 'third']):
        await memory.store_turn(
            session_id='multi',
            player_input=f'turn {seq}',
            response_text=text,
            sentiment='neutral',
            game_state={},
        )

    log_path = real_mode / 'multi' / 'conversation.jsonl'
    lines = log_path.read_text(encoding='utf-8').splitlines()
    assert len(lines) == 3
    payloads = [json.loads(line) for line in lines]
    assert [p['companionResponse'] for p in payloads] == ['first', 'second', 'third']


async def test_recall_returns_empty_when_no_palace_yet(real_mode: Path) -> None:
    """First-turn recall before any store happens must not crash."""
    recall = await memory.recall(session_id='fresh-session', query='anything')
    assert recall.items == []


async def test_recall_swallows_mempalace_errors(
    real_mode: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If MemoryStack raises, the turn must continue with empty recall —
    a broken palace cannot block dialogue."""
    palace_dir = real_mode / 'broken-session'
    palace_dir.mkdir()
    # An empty palace dir will make MemoryStack raise at search time.
    # We accept whatever it throws; the assertion is that we get back
    # an empty result rather than an exception escaping the function.
    result = await memory.recall(session_id='broken-session', query='x')
    assert result.items == []
