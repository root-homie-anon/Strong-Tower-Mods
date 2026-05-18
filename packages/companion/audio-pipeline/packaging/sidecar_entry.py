"""PyInstaller entry point for the frozen sidecar binary.

PyInstaller wants a real file as its entry point rather than a
``python -m module`` invocation. This module is intentionally trivial
— it imports ``audio_pipeline.main:main`` and calls it — so the
behaviour of the frozen binary is exactly the same as
``python -m audio_pipeline.main`` for both contributors and CI.
"""

from audio_pipeline.main import main

if __name__ == '__main__':
    main()
