"""Unit tests for the voice synthesis subpackage (mock mode only).

These tests run in-process — no sidecar / cloud subprocesses — so a
voice regression fails fast and with a focused stack trace before the
heavier round-trip suite even spins up.

Real ElevenLabs HTTP behaviour is intentionally not exercised here:
that path requires a live API key, has cost, and is better validated
manually before the first Phase C in-game test.
"""

from __future__ import annotations

import wave
from pathlib import Path

import pytest

from audio_pipeline.voice import elevenlabs, pipeline
from audio_pipeline.voice.packaging import write_wav


@pytest.fixture(autouse=True)
def _force_mock_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test in this module runs against the mock TTS client."""
    monkeypatch.setenv('ELEVENLABS_MOCK', 'true')


@pytest.fixture()
def output_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv('AUDIO_OUTPUT_DIR', str(tmp_path))
    return tmp_path


async def test_mock_synthesize_returns_deterministic_silence() -> None:
    a = await elevenlabs.synthesize('hello commonwealth')
    b = await elevenlabs.synthesize('a completely different prompt')

    # Mock ignores the input text — the contract is deterministic silence.
    # Asserting byte-identity here protects against accidental drift if
    # someone later tries to make the mock "more realistic".
    assert a.audio_bytes == b.audio_bytes
    assert a.sample_rate_hz == elevenlabs.PCM_SAMPLE_RATE_HZ
    assert a.bits_per_sample == elevenlabs.PCM_BITS_PER_SAMPLE
    assert a.channels == elevenlabs.PCM_CHANNELS

    # 1.0 s at 44.1 kHz / 16-bit / mono == 88200 bytes.
    assert len(a.audio_bytes) == elevenlabs.PCM_SAMPLE_RATE_HZ * 2
    assert a.duration_ms == 1000


def test_write_wav_produces_readable_riff_wave(tmp_path: Path) -> None:
    payload = b'\x00' * (elevenlabs.PCM_SAMPLE_RATE_HZ * 2)  # 1 s of silence
    result = elevenlabs.TtsResult(
        audio_bytes=payload,
        sample_rate_hz=elevenlabs.PCM_SAMPLE_RATE_HZ,
        bits_per_sample=elevenlabs.PCM_BITS_PER_SAMPLE,
        channels=elevenlabs.PCM_CHANNELS,
    )

    target = tmp_path / 'nested' / 'dir' / 'out.wav'
    write_wav(result, target)

    assert target.is_file()

    # Round-trip through stdlib wave so we know the header is well-formed
    # and the PCM frames are intact — a raw byte compare would not catch
    # a malformed RIFF chunk size.
    with wave.open(str(target), 'rb') as readback:
        assert readback.getframerate() == elevenlabs.PCM_SAMPLE_RATE_HZ
        assert readback.getnchannels() == elevenlabs.PCM_CHANNELS
        assert readback.getsampwidth() == elevenlabs.PCM_BITS_PER_SAMPLE // 8
        assert readback.readframes(readback.getnframes()) == payload


async def test_synthesize_for_turn_writes_artifact_to_output_dir(output_dir: Path) -> None:
    artifact = await pipeline.synthesize_for_turn(
        text='ignored under mock mode',
        session_id='session-abc',
        seq=7,
    )

    assert artifact.format == 'wav'
    assert artifact.duration_ms == 1000
    assert artifact.audio_path == output_dir / 'session-abc_7.wav'
    assert artifact.audio_path.is_file()

    # Filename convention is part of the contract with the F4SE plugin
    # (Phase C) — it lets the plugin construct an expected path from
    # (sessionId, seq) when polling for completion. Lock it in.
    assert artifact.audio_path.name == 'session-abc_7.wav'


async def test_synthesize_for_turn_overwrites_on_seq_reuse(output_dir: Path) -> None:
    """Re-using a (sessionId, seq) pair is a caller bug — surface it loudly by
    overwriting rather than silently appending or failing."""
    first = await pipeline.synthesize_for_turn('a', session_id='s', seq=1)
    first_mtime = first.audio_path.stat().st_mtime_ns

    second = await pipeline.synthesize_for_turn('b', session_id='s', seq=1)

    assert second.audio_path == first.audio_path
    assert second.audio_path.stat().st_mtime_ns >= first_mtime
