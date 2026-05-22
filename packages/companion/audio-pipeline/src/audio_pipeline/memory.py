"""MemPalace-backed persistent memory for the companion sidecar.

Two operations, both per turn:

* :func:`recall` — vector-search the player's local palace for memories
  relevant to the current trigger + player input. The result augments
  the ``memoryRecall`` field the F4SE plugin sends so the companion
  remembers the player across save reloads and sessions.

* :func:`store_turn` — append the completed turn to a JSONL conversation
  log inside the palace directory. mempalace's ``convo_miner`` CLI
  ingests these logs into the palace's vector store. Mining happens
  out-of-band (between sessions, on a schedule, or via MCM); within
  the same session the just-stored turn is not yet recallable — that
  gap is already filled by the cloud's per-request ``history`` field
  which the F4SE plugin populates from recent in-game dialogue.

Mock mode (``MEMORY_MOCK=true``) makes both operations no-ops so the
existing audio-pipeline test suite (which does not provision a
palace) continues to pass. The cloud companion API does not need to
know whether memory is mock or real — both modes return the same
``MemoryRecall`` shape.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Per-user data root. Memory always lives on the user's machine — the
# CLAUDE.md spec is explicit that there is no cloud memory sync, so
# this path is intentionally local. MCM exposes a backup option that
# zips this directory; restore is the reverse.
_DEFAULT_MEMORY_DIR = Path.home() / '.local' / 'share' / 'strong-tower-mods' / 'memory'

_CONVERSATION_LOG_FILENAME = 'conversation.jsonl'

# Strings mempalace returns when no real memory is available — observed
# empirically (the upstream library does not expose them as constants).
# Keep this list literal-match so a future "No palace found." rename or
# a new sentinel surfaces immediately as a regression in test_memory
# rather than as silently-dropped recall output.
_MEMPALACE_EMPTY_SENTINELS: frozenset[str] = frozenset({
    'No palace found.',
    'No memories found.',
    'No results.',
})


@dataclass
class MemoryRecall:
    """Result of a :func:`recall` call.

    ``items`` is a list of dicts whose shape is compatible with the
    cloud's ``memoryRecall`` JSON-schema slot (``array`` of ``object``).
    Each item has at minimum ``source`` and ``text``; richer fields
    (score, palace coordinates) are passed through when mempalace
    surfaces them.
    """

    items: list[dict[str, Any]] = field(default_factory=list)


def _is_mock_mode() -> bool:
    return os.environ.get('MEMORY_MOCK', '').lower() == 'true'


def _palace_root() -> Path:
    override = os.environ.get('MEMORY_DIR')
    return Path(override) if override else _DEFAULT_MEMORY_DIR


def _palace_path_for(session_id: str) -> Path:
    """Per-session palace subdir. sessionId is validated by the cloud
    schema to ``^[A-Za-z0-9_-]+$``, so direct interpolation is safe.
    """
    return _palace_root() / session_id


async def recall(session_id: str, query: str, n_results: int = 8) -> MemoryRecall:
    """Look up memories relevant to ``query`` in the player's palace.

    Returns an empty ``MemoryRecall`` in mock mode, when the palace
    has not been initialized yet, or when mempalace itself raises —
    failing recall must never block a turn. The cloud will still
    respond using only the per-request ``history`` and ``gameState``;
    the player simply loses cross-session continuity for that one turn.
    """
    if _is_mock_mode():
        return MemoryRecall()

    palace_path = _palace_path_for(session_id)
    if not palace_path.exists():
        # No palace materialised yet for this session — first turn of
        # a new player, or memory writes have been disabled.
        return MemoryRecall()

    try:
        # Import lazily so a missing mempalace install only breaks the
        # real path, not the mock path the existing tests depend on.
        from mempalace.layers import MemoryStack
    except ImportError:
        logger.warning('mempalace not installed; recall is a no-op')
        return MemoryRecall()

    try:
        stack = MemoryStack(palace_path=str(palace_path))
        text = stack.search(query=query, n_results=n_results)
    except Exception as exc:
        # mempalace surfaces a handful of specific errors
        # (PalaceNotFoundError, CollectionNotInitializedError, SearchError);
        # we catch broadly because none of them are recoverable inside a
        # turn — the only valid response is "no memories this time."
        logger.warning('Memory recall failed for session %s: %s', session_id, exc)
        return MemoryRecall()

    if not text or not text.strip():
        return MemoryRecall()

    # mempalace returns short sentinel strings instead of raising for
    # several non-error empty states (palace not initialised, empty
    # collection, no vector hits). We treat them as empty rather than
    # forwarding the sentinel to the cloud where it would just be
    # noise in the prompt. The list is intentionally narrow — if we
    # ever see a new sentinel in the wild, surface it as memory rather
    # than silently dropping; that's why this is a literal-match list,
    # not a regex.
    stripped = text.strip()
    if stripped in _MEMPALACE_EMPTY_SENTINELS:
        return MemoryRecall()

    # MemoryStack.search returns formatted text; we wrap it as a single
    # opaque item so the cloud schema's ``items: object`` constraint is
    # satisfied without us pretending to know the internal structure
    # of mempalace's prose output.
    return MemoryRecall(items=[{'source': 'mempalace', 'text': text}])


async def store_turn(
    session_id: str,
    player_input: str | None,
    response_text: str,
    sentiment: str,
    game_state: dict[str, Any],
) -> None:
    """Append the completed turn to the session's conversation log.

    No-op in mock mode. In real mode the log is created on demand the
    first turn of a session; subsequent turns append. The directory
    structure is the same one mempalace's miner expects, so a
    scheduled ``mempalace mine`` run promotes these turns into the
    palace's vector store between sessions.
    """
    if _is_mock_mode():
        return

    palace_path = _palace_path_for(session_id)
    try:
        palace_path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning('Cannot create palace dir %s: %s', palace_path, exc)
        return

    record = {
        'timestamp': time.time(),
        'sessionId': session_id,
        'playerInput': player_input,
        'companionResponse': response_text,
        'sentiment': sentiment,
        'gameState': game_state,
    }

    log_path = palace_path / _CONVERSATION_LOG_FILENAME
    try:
        # Append-only is cheaper and crash-safer than read+write+flush:
        # a power loss mid-write can corrupt at most one line, not the
        # whole conversation. mempalace's miner skips malformed JSON
        # lines, so a partial trailing line is recovered transparently.
        with log_path.open('a', encoding='utf-8') as fh:
            fh.write(json.dumps(record) + '\n')
    except OSError as exc:
        logger.warning('Cannot append to conversation log %s: %s', log_path, exc)
