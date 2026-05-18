"""ElevenLabs TTS client.

We request raw PCM (signed 16-bit little-endian, 44.1 kHz mono) directly
from ElevenLabs rather than the default MP3 so we can write a WAV file
without pulling in an MP3 decoder (ffmpeg / pydub) as a dependency.
PCM also matches what xWMAEncode.exe expects as input when XWM/FUZ
packaging lands in a later phase.

Mock mode (``ELEVENLABS_MOCK=true``) returns a deterministic 1.0 s of
silence so the entire pipeline can be exercised end-to-end without an
API key. The mock contract is identical to the real client: it returns
raw PCM bytes plus the sample rate and channel count needed to wrap
those bytes as a WAV file.

The output format string ``pcm_44100`` is the ElevenLabs identifier;
44.1 kHz / 16-bit / mono is also the standard input format the
Bethesda XWM toolchain expects, so this choice carries through to
later packaging work without re-sampling.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

from ..errors import AudioPipelineError

logger = logging.getLogger(__name__)

_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io'
_DEFAULT_MODEL_ID = 'eleven_turbo_v2_5'
_DEFAULT_OUTPUT_FORMAT = 'pcm_44100'

# Sample-rate / channel constants for the default output format above.
# Exposed so the WAV writer in packaging.py does not need to parse the
# ``pcm_<rate>`` string and so tests can assert on a single source of truth.
PCM_SAMPLE_RATE_HZ = 44100
PCM_BITS_PER_SAMPLE = 16
PCM_CHANNELS = 1

# Mock silence duration. One second is long enough that the F4SE plugin
# can prove playback wiring works during development and short enough
# that tests stay fast.
_MOCK_SILENCE_SECONDS = 1.0


class ElevenLabsError(AudioPipelineError):
    """ElevenLabs API surfaced an error or was unreachable."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__('ELEVENLABS_ERROR', message, status_code)


@dataclass(frozen=True)
class TtsResult:
    """Raw TTS output. ``audio_bytes`` are interleaved PCM samples."""

    audio_bytes: bytes
    sample_rate_hz: int
    bits_per_sample: int
    channels: int

    @property
    def duration_ms(self) -> int:
        """Duration in whole milliseconds, rounded down."""
        bytes_per_sample = self.bits_per_sample // 8
        total_samples = len(self.audio_bytes) // (bytes_per_sample * self.channels)
        return int((total_samples / self.sample_rate_hz) * 1000)


def _mock_silence() -> TtsResult:
    """Return ``_MOCK_SILENCE_SECONDS`` of silence at the default PCM format.

    The mock is deterministic: the same call returns byte-identical
    output every time, which lets tests assert on file size as well as
    file existence.
    """
    bytes_per_sample = PCM_BITS_PER_SAMPLE // 8
    total_samples = int(PCM_SAMPLE_RATE_HZ * _MOCK_SILENCE_SECONDS)
    silence = b'\x00' * (total_samples * bytes_per_sample * PCM_CHANNELS)
    return TtsResult(
        audio_bytes=silence,
        sample_rate_hz=PCM_SAMPLE_RATE_HZ,
        bits_per_sample=PCM_BITS_PER_SAMPLE,
        channels=PCM_CHANNELS,
    )


def _is_mock_mode() -> bool:
    return os.environ.get('ELEVENLABS_MOCK', '').lower() == 'true'


async def synthesize(text: str, voice_id: str | None = None) -> TtsResult:
    """Synthesise ``text`` to PCM audio.

    In mock mode the ``text`` and ``voice_id`` arguments are accepted but
    ignored — the returned silence is fixed length. In real mode they
    are forwarded to the ElevenLabs ``/v1/text-to-speech/{voice_id}``
    endpoint with ``output_format=pcm_44100`` so the response body is
    raw PCM ready for the WAV writer.
    """
    if _is_mock_mode():
        return _mock_silence()

    api_key = os.environ.get('ELEVENLABS_API_KEY')
    if not api_key:
        raise ElevenLabsError(
            'ELEVENLABS_API_KEY is not set and ELEVENLABS_MOCK is not "true"',
            status_code=500,
        )

    voice = voice_id or os.environ.get('ELEVENLABS_VOICE_ID')
    if not voice:
        raise ElevenLabsError(
            'No voice id provided and ELEVENLABS_VOICE_ID is not set',
            status_code=500,
        )

    url = f'{_ELEVENLABS_BASE_URL}/v1/text-to-speech/{voice}'
    params = {'output_format': _DEFAULT_OUTPUT_FORMAT}
    headers = {
        'xi-api-key': api_key,
        'accept': 'audio/pcm',
        'content-type': 'application/json',
    }
    payload = {
        'text': text,
        'model_id': os.environ.get('ELEVENLABS_MODEL_ID', _DEFAULT_MODEL_ID),
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            response = await client.post(url, params=params, headers=headers, json=payload)
    except httpx.ConnectError as exc:
        raise ElevenLabsError(f'Cannot reach ElevenLabs: {exc}', status_code=503) from exc
    except httpx.HTTPError as exc:
        raise ElevenLabsError(f'ElevenLabs HTTP error: {exc}') from exc

    if response.status_code == 401:
        raise ElevenLabsError('ElevenLabs rejected the API key', status_code=502)
    if response.status_code == 429:
        raise ElevenLabsError('ElevenLabs rate limit exceeded', status_code=429)
    if response.status_code >= 400:
        # Surface the upstream message verbatim when possible — ElevenLabs
        # returns useful detail on validation failures (bad voice id,
        # bad model id, character limit exceeded, etc.).
        try:
            detail = response.json().get('detail', response.text)
        except ValueError:
            detail = response.text
        raise ElevenLabsError(
            f'ElevenLabs error {response.status_code}: {detail}',
            status_code=502,
        )

    return TtsResult(
        audio_bytes=response.content,
        sample_rate_hz=PCM_SAMPLE_RATE_HZ,
        bits_per_sample=PCM_BITS_PER_SAMPLE,
        channels=PCM_CHANNELS,
    )
