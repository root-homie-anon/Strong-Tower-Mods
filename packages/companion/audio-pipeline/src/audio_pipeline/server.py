from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import memory
from .cloud_client import request_turn
from .errors import AudioPipelineError
from .voice import synthesize_for_turn

SIDECAR_PORT = int(os.environ.get('SIDECAR_PORT', '4999'))

app = FastAPI(title='companion-sidecar', version='0.1.0')


class TurnRequest(BaseModel):
    sessionId: str = Field(min_length=1)
    seq: int = Field(ge=1)
    trigger: str = Field(min_length=1)
    # Player-typed or transcribed dialogue. None when the trigger does not
    # carry player input (ambient one-liners, scripted prompts). Validated
    # by the cloud schema with the same nullability rule.
    playerInput: str | None = None
    gameState: dict[str, Any] = Field(default_factory=dict)
    # Client-supplied memory entries (the F4SE plugin may inject in-game
    # context here). The sidecar adds MemPalace recall on top before
    # forwarding to the cloud.
    memoryRecall: list[Any] = Field(default_factory=list)
    history: list[Any] = Field(default_factory=list)


@app.exception_handler(AudioPipelineError)
async def pipeline_error_handler(request: Any, exc: AudioPipelineError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={'error': exc.code, 'message': str(exc)},
    )


@app.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok', 'service': 'companion-sidecar', 'version': '0.1.0'}


@app.post('/turn/request')
async def turn_request(body: TurnRequest) -> dict[str, Any]:
    # Augment the client-supplied memoryRecall with MemPalace search results.
    # The query is the trigger + player input — the same string the cloud
    # will see in <trigger> and <player_input>, so recall surfaces memories
    # relevant to what the companion is actually about to respond to. Failures here
    # are swallowed inside memory.recall() — the turn proceeds with whatever
    # memoryRecall the client provided.
    query = body.trigger if not body.playerInput else f'{body.trigger} {body.playerInput}'
    palace_recall = await memory.recall(session_id=body.sessionId, query=query)
    augmented_recall = list(body.memoryRecall) + palace_recall.items

    try:
        cloud_response = await request_turn(
            session_id=body.sessionId,
            seq=body.seq,
            trigger=body.trigger,
            player_input=body.playerInput,
            game_state=body.gameState,
            memory_recall=augmented_recall,
            history=body.history,
        )
    except AudioPipelineError:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Synthesise the spoken audio for this turn. Phase A: WAV output via ElevenLabs
    # (or a deterministic 1.0 s silent WAV under ELEVENLABS_MOCK=true). FUZ/XWM
    # packaging and the real LIP file land in Phase B alongside FaceFXWrapper.
    artifact = await synthesize_for_turn(
        text=cloud_response['responseText'],
        session_id=cloud_response['sessionId'],
        seq=cloud_response['seq'],
    )

    # Persist the completed turn to the player's palace conversation log.
    # The store happens AFTER synthesis succeeds so a failed turn is not
    # remembered as if it had happened. mempalace's miner ingests these
    # logs between sessions.
    await memory.store_turn(
        session_id=body.sessionId,
        player_input=body.playerInput,
        response_text=cloud_response['responseText'],
        sentiment=cloud_response['sentiment'],
        game_state=body.gameState,
    )

    return {
        'seq': cloud_response['seq'],
        'sessionId': cloud_response['sessionId'],
        'responseText': cloud_response['responseText'],
        'sentiment': cloud_response['sentiment'],
        'morphSeq': cloud_response.get('morphHints', []),
        'audioPath': str(artifact.audio_path),
        'audioFormat': artifact.format,
        'lipPath': '',
        'durationMs': artifact.duration_ms,
        'source': cloud_response['source'],
    }
