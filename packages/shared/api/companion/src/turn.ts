import { Ajv } from 'ajv';
import type { FastifyInstance } from 'fastify';

// AJV is pulled in transitively by Fastify. We instantiate our own instance here
// because @fastify/websocket does not expose JSON Schema validation for incoming
// WS frames — Fastify schema validation is HTTP request/response only.
const ajv = new Ajv({ allErrors: false });

const turnRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'type',
    'seq',
    'sessionId',
    'trigger',
    'playerInput',
    'characterContext',
    'gameState',
    'memoryRecall',
    'history',
  ],
  properties: {
    type: { type: 'string', const: 'turn.request' },
    seq: { type: 'integer', minimum: 0 },
    sessionId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[A-Za-z0-9_-]+$',
    },
    trigger: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
    },
    playerInput: {
      type: ['string', 'null'],
      maxLength: 4096,
    },
    characterContext: {
      type: ['string', 'null'],
      maxLength: 4096,
    },
    gameState: {
      type: 'object',
      additionalProperties: true,
    },
    memoryRecall: {
      type: 'array',
      maxItems: 15,
      items: { type: 'object' },
    },
    history: {
      type: 'array',
      maxItems: 12,
      items: { type: 'object' },
    },
  },
} as const;

const validateTurnRequest = ajv.compile(turnRequestSchema);

interface TurnRequestFrame {
  type: 'turn.request';
  seq: number;
  sessionId: string;
  trigger: string;
  playerInput: string | null;
  characterContext: string | null;
  gameState: Record<string, unknown>;
  memoryRecall: unknown[];
  history: unknown[];
}

interface TurnResponseFrame {
  type: 'turn.response';
  seq: number;
  sessionId: string;
  responseText: string;
  sentiment: string;
  morphHints: unknown[];
  audioB64: string;
  billingMs: number;
  source: 'cloud-stub';
}

function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer +(\S+)$/i.exec(authHeader);
  return match?.[1] ?? null;
}

export function registerTurn(app: FastifyInstance): void {
  app.get(
    '/companion/turn',
    { websocket: true },
    (socket, req) => {
      const token = extractBearer(req.headers['authorization']);
      if (!token) {
        socket.send(
          JSON.stringify({ error: 'AUTH_ERROR', message: 'Missing or malformed Authorization header' })
        );
        socket.close(1008, 'Unauthorized');
        return;
      }

      socket.on('message', (raw: Buffer | string) => {
        let frame: unknown;
        try {
          frame = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Frame is not valid JSON' }));
          return;
        }

        if (!validateTurnRequest(frame)) {
          const firstError = validateTurnRequest.errors?.[0];
          // ajv default messages are safe to surface; they describe the schema constraint violated,
          // not any internal validator state or server path.
          const message =
            firstError != null
              ? `${firstError.instancePath !== '' ? firstError.instancePath + ' ' : ''}${firstError.message ?? 'invalid'}`
              : 'Frame failed schema validation';
          socket.send(JSON.stringify({ error: 'VALIDATION_ERROR', message }));
          return;
        }

        // validateTurnRequest is a type guard compiled from the schema — frame is now TurnRequestFrame.
        const validFrame = frame as TurnRequestFrame;

        const response: TurnResponseFrame = {
          type: 'turn.response',
          seq: validFrame.seq,
          sessionId: validFrame.sessionId,
          responseText: `[stub] Acknowledged turn ${validFrame.seq} for session ${validFrame.sessionId}. Trigger: ${validFrame.trigger}`,
          sentiment: 'neutral',
          morphHints: [],
          audioB64: '',
          billingMs: 0,
          source: 'cloud-stub',
        };

        socket.send(JSON.stringify(response));
      });
    }
  );
}
