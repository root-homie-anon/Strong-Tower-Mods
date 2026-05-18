"""Audio container packaging.

Phase A only writes a WAV file. The CLAUDE.md Phase 1 spec also calls
out XWM and FUZ packaging — both are deferred to a later phase because:

* xWMAEncode.exe is a Microsoft tool that is not redistributable, must
  be located on the user's machine via an env var, and only makes
  sense to wire up once we have an F4SE plugin (Phase C) that actually
  consumes FUZ files. Until then there is no consumer to test against.
* The FUZ container format is trivial (FUZE magic + LIP length-prefix +
  LIP bytes + XWM bytes) and depends on the LIP file which is itself a
  Phase B (FaceFXWrapper) concern. Producing FUZ before LIP is real
  would just be writing zero-length LIP into the container.

For Phase A we ship WAV. The pipeline layer surfaces the actual
container format in its response so downstream consumers (and the F4SE
plugin when it lands) can branch on it rather than guessing from the
file extension.
"""

from __future__ import annotations

import wave
from pathlib import Path

from .elevenlabs import TtsResult


def write_wav(result: TtsResult, output_path: Path) -> None:
    """Write a TTS result to a RIFF/WAVE file at ``output_path``.

    The parent directory is created if missing. Existing files are
    overwritten — turns are addressed by ``(sessionId, seq)`` and seq
    is monotonic per session, so a collision here means the caller
    re-used a seq, which is a caller bug we surface immediately by
    overwriting rather than silently ignoring.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), 'wb') as wav:
        wav.setnchannels(result.channels)
        wav.setsampwidth(result.bits_per_sample // 8)
        wav.setframerate(result.sample_rate_hz)
        wav.writeframes(result.audio_bytes)
