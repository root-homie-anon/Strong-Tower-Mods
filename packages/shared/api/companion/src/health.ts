import type { FastifyInstance } from 'fastify';

export function registerHealth(app: FastifyInstance): void {
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', service: 'companion-api', version: '0.1.0' });
  });
}
