"""Per-turn voice synthesis orchestrator.

The FastAPI server calls :func:`synthesize_for_turn` after it has the
text response back from the cloud. The orchestrator:

1. Calls the ElevenLabs client (mock or real, controlled by
   ``ELEVENLABS_MOCK``).
2. Writes the resulting audio to the per-user output directory.
3. Returns the on-disk path, duration in milliseconds, and the
   container format. The container format is surfaced explicitly so
   the F4SE plugin (Phase C) does not have to guess from the file
   extension when FUZ packaging is added later.

Filename convention: ``<sessionId>_<seq>.<ext>``. sessionId is
validated by the cloud schema to ``^[A-Za-z0-9_-]+$`` (no path
separators) so it is safe to interpolate directly without sanitisation.
seq is an integer.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from . import elevenlabs
from .packaging import write_wav

# Output directory. Defaults to the same per-user data directory
# convention the main module uses for the sidecar lockfile so the
# whole sidecar footprint lives under one parent on POSIX. Override
# with AUDIO_OUTPUT_DIR for tests and for the eventual game-Data-folder
# integration target.
_DEFAULT_OUTPUT_DIR = Path.home() / '.local' / 'share' / 'strong-tower-mods' / 'audio'


@dataclass(frozen=True)
class VoiceArtifact:
    audio_path: Path
    duration_ms: int
    format: str  # 'wav' for Phase A; 'fuz' once XWM/FUZ packaging lands.


def _output_dir() -> Path:
    override = os.environ.get('AUDIO_OUTPUT_DIR')
    if override:
        return Path(override)
    return _DEFAULT_OUTPUT_DIR


async def synthesize_for_turn(text: str, session_id: str, seq: int) -> VoiceArtifact:
    """Synthesise ``text`` and persist the audio for ``(session_id, seq)``.

    Returns the artifact descriptor. The caller (server.py) is responsible
    for handing the artifact's fields back to the F4SE plugin via the
    sidecar response envelope.
    """
    tts = await elevenlabs.synthesize(text)

    filename = f'{session_id}_{seq}.wav'
    output_path = _output_dir() / filename
    write_wav(tts, output_path)

    return VoiceArtifact(
        audio_path=output_path,
        duration_ms=tts.duration_ms,
        format='wav',
    )
