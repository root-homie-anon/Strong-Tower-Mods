from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .cloud_client import request_turn
from .errors import AudioPipelineError

SIDECAR_PORT = int(os.environ.get('SIDECAR_PORT', '4999'))

app = FastAPI(title='companion-sidecar', version='0.1.0')


class TurnRequest(BaseModel):
    sessionId: str = Field(min_length=1)
    seq: int = Field(ge=1)
    trigger: str = Field(min_length=1)
    gameState: dict[str, Any] = Field(default_factory=dict)
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
    try:
        cloud_response = await request_turn(
            session_id=body.sessionId,
            seq=body.seq,
            trigger=body.trigger,
            game_state=body.gameState,
            memory_recall=body.memoryRecall,
            history=body.history,
        )
    except AudioPipelineError:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Transform cloud turn.response hints into the sidecar dispatch shape returned to the F4SE caller.
    # Step 4 (ElevenLabs + FaceFXWrapper) replaces the placeholder audioPath/lipPath/morphSeq here.
    return {
        'seq': cloud_response['seq'],
        'sessionId': cloud_response['sessionId'],
        'responseText': cloud_response['responseText'],
        'sentiment': cloud_response['sentiment'],
        'morphSeq': cloud_response.get('morphHints', []),
        'audioPath': '',
        'lipPath': '',
        'durationMs': 0,
        'source': cloud_response['source'],
    }
