/**
 * Builds the companion-API Fastify instance.
 *
 * Split out from server.ts so tests can import ``buildApp`` and call
 * ``app.inject(...)`` without standing up an actual TCP listener.
 * The server.ts entry point still wraps this in a ``listen()`` for
 * production / dev / conftest.py.
 */

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRateLimit from '@fastify/rate-limit';
import { registerHealth } from './health.js';
import { registerTurn } from './turn.js';
import { registerSessions } from './sessions.js';
import { registerLoadOrder } from './load-order.js';
import { registerConflict } from './conflict.js';
import { CompanionApiError } from './errors.js';

export interface BuildAppOptions {
  /** Pass ``logger: false`` from tests to silence Fastify's startup noise. */
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  // 64 KiB is generous for a full turn.request envelope; default (100 MiB) is unacceptable for this wire.
  await app.register(fastifyWebsocket, { options: { maxPayload: 65536 } });

  // Per-IP rate limit on the WS upgrade handshake for /companion/turn only.
  // The upgrade is a GET request, so the rate limiter applies naturally before the socket is opened.
  // /health is excluded via allowList.
  await app.register(fastifyRateLimit, {
    max: 60,
    timeWindow: '1 minute',
    skipOnError: false,
    keyGenerator: (req) => req.ip,
    allowList: (_req, _key) => _req.routeOptions.url === '/health',
  });

  app.setErrorHandler((error: FastifyError, _req, reply) => {
    if (error instanceof CompanionApiError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error.validation) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  registerHealth(app);
  registerSessions(app);
  registerTurn(app);
  registerLoadOrder(app);
  registerConflict(app);

  return app;
}
