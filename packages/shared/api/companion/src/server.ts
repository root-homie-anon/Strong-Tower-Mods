import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { registerHealth } from './health.js';
import { registerTurn } from './turn.js';
import { CompanionApiError } from './errors.js';

const PORT = parseInt(process.env['CLOUD_PORT'] ?? '8080', 10);

async function buildApp() {
  const app = Fastify({ logger: true });

  // 64 KiB is generous for a full turn.request envelope; default (100 MiB) is unacceptable for this wire.
  await app.register(fastifyWebsocket, { options: { maxPayload: 65536 } });

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
  registerTurn(app);

  return app;
}

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
