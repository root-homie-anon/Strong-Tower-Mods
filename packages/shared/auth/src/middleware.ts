/**
 * Fastify auth middleware.
 *
 * Registers a preHandler hook that:
 *   1. Extracts the bearer token.
 *   2. Verifies the JWT signature, issuer, audience, and expiry.
 *   3. Confirms the ApiSession is still open (not closed).
 *   4. Attaches the claims + session id to `request.auth` for handlers.
 *
 * Routes opt in per-route via `requireAuth(app, opts)` rather than a
 * global hook so the /health endpoint (which the test harness polls
 * before any token has been minted) can stay unauthenticated.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { repositories } from '@strong-tower/db';
import { verifySessionToken, type SessionClaims } from './jwt.js';

export interface AuthContext {
  claims: SessionClaims;
  /** Convenience accessor — claims.sub. */
  userId: string;
  /** Convenience accessor — claims.jti. */
  apiSessionJti: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  auth: AuthContext;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer +(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Register an auth preHandler scoped to ``opts.routePrefix`` (or
 * globally if omitted). The hook short-circuits with a 401 on any
 * verification failure; downstream handlers can rely on `request.auth`
 * being populated.
 */
export function requireAuth(
  app: FastifyInstance,
  opts: { routePrefix?: string } = {}
): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (opts.routePrefix && !request.url.startsWith(opts.routePrefix)) {
      return;
    }

    const token = extractBearer(request);
    if (!token) {
      return reply
        .code(401)
        .send({ error: 'AUTH_ERROR', message: 'Missing or malformed Authorization header' });
    }

    let claims: SessionClaims;
    try {
      claims = await verifySessionToken(token);
    } catch {
      return reply.code(401).send({ error: 'AUTH_ERROR', message: 'Invalid or expired token' });
    }

    // Confirm the session is still open. A closed session means the
    // user explicitly ended it (or the cloud closed it after a Custom-
    // tier pre-auth capture); the token must not continue to work.
    const session = await repositories.sessions.findByJti(claims.jti);
    if (!session) {
      return reply
        .code(401)
        .send({ error: 'AUTH_ERROR', message: 'Session not found' });
    }
    if (session.closedAt) {
      return reply
        .code(401)
        .send({ error: 'AUTH_ERROR', message: 'Session has been closed' });
    }

    request.auth = {
      claims,
      userId: claims.sub,
      apiSessionJti: claims.jti,
    };
  });
}
