"""Voice synthesis subpackage for the companion sidecar.

Public entry point: :func:`audio_pipeline.voice.pipeline.synthesize_for_turn`.

Modules
-------
elevenlabs
    Async HTTP client for ElevenLabs TTS plus a deterministic mock client.
packaging
    PCM -> WAV writer (stdlib only). XWM/FUZ packaging is a Phase B/C
    concern (requires xWMAEncode.exe and an in-game consumer to test
    against) and is intentionally stubbed here.
pipeline
    Orchestrator that the FastAPI server calls per turn. Returns the
    on-disk audio path, duration in milliseconds, and the container
    format string.
"""

from .pipeline import synthesize_for_turn

__all__ = ['synthesize_for_turn']
