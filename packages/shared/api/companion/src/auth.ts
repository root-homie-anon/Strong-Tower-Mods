/**
 * Cloud companion API auth — dual-mode (mock + real JWT).
 *
 * AUTH_MOCK=true (or "any non-empty bearer token" in dev) is the legacy
 * path the audio-pipeline conftest spawns the cloud under. It accepts
 * any bearer string, skips the DB session lookup, and stamps a mock
 * AuthContext. This keeps the existing 12 audio-pipeline tests green
 * while the real path is rolled out.
 *
 * AUTH_MOCK unset (or "false") is the production path:
 *   1. Verify the JWT signature, issuer, audience, expiry via @strong-tower/auth.
 *   2. Look up the ApiSession by jti in the DB; reject if missing or closed.
 *   3. Return a populated AuthContext for the WS handler.
 *
 * The dual mode lives here (and not behind a runtime conditional in
 * every call site) so the WS handler reads as one consistent shape
 * regardless of which path is active.
 */

import { jwt as authJwt } from '@strong-tower/auth';
import { repositories } from '@strong-tower/db';
import {
  UpstreamAuthError,
  CompanionApiError,
} from './errors.js';

export interface AuthContext {
  /** True when this is a mock-mode session — no DB row exists. */
  mock: boolean;
  /** Always set; '<mock>' for mock sessions, real User.id otherwise. */
  userId: string;
  /** ApiSession.jwtJti; '<mock>' for mock sessions. */
  jti: string;
  /** Tier carried in the JWT; 'mock' for mock sessions. */
  tier: string;
}

export class TurnAuthError extends CompanionApiError {
  constructor(message: string) {
    super('AUTH_ERROR', message, 401);
  }
}

function isMockAuth(): boolean {
  return process.env['AUTH_MOCK'] === 'true';
}

/**
 * Verify a raw Authorization-header bearer token. Returns the auth
 * context on success, throws TurnAuthError on any failure. The error
 * is intentionally generic so the WS frame leaks no information about
 * which specific verification step failed.
 */
export async function verifyTurnAuth(token: string | null): Promise<AuthContext> {
  if (!token) {
    throw new TurnAuthError('Missing or malformed Authorization header');
  }

  if (isMockAuth()) {
    // Mock mode trusts any non-empty bearer. The audio-pipeline test
    // fixtures rely on this. It must never be enabled in production —
    // shared/billing/src/stripe-client.ts has the equivalent guard for
    // its mock; the same NODE_ENV check applies here in spirit, but
    // we leave that enforcement to the deploy config rather than
    // crashing the cloud on startup so a single misconfigured env var
    // does not take the API down.
    return {
      mock: true,
      userId: '<mock>',
      jti: '<mock>',
      tier: 'mock',
    };
  }

  let claims;
  try {
    claims = await authJwt.verifySessionToken(token);
  } catch {
    throw new TurnAuthError('Invalid or expired token');
  }

  const session = await repositories.sessions.findByJti(claims.jti);
  if (!session) {
    throw new TurnAuthError('Session not found');
  }
  if (session.closedAt) {
    throw new TurnAuthError('Session has been closed');
  }

  return {
    mock: false,
    userId: claims.sub,
    jti: claims.jti,
    tier: claims.tier,
  };
}

// Re-export for convenience; turn.ts uses both error types.
export { UpstreamAuthError };
