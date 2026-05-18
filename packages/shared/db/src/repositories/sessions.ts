/**
 * ApiSession repository.
 *
 * Lifecycle: open() at JWT mint time, close() at WS disconnect or
 * timeout. Sessions are persisted (not in-memory) so a cloud restart
 * does not lose ongoing-session attribution or strand a Custom-tier
 * pre-authorization that was never released.
 */

import type { ApiSession } from '../../prisma-client/index.js';
import { prisma } from '../client.js';

export interface OpenSessionInput {
  userId: string;
  jwtJti: string;
  tier: string;
  /**
   * Microdollars pre-authorized on Stripe at session open. Only set
   * for the Custom tier; fixed-price tiers leave this null and never
   * touch the pre-auth path.
   */
  preAuthAmountMicrodollars?: number;
  stripePreAuthIntentId?: string;
}

export async function open(input: OpenSessionInput): Promise<ApiSession> {
  return prisma.apiSession.create({
    data: {
      userId: input.userId,
      jwtJti: input.jwtJti,
      tier: input.tier,
      preAuthAmountMicrodollars: input.preAuthAmountMicrodollars ?? null,
      stripePreAuthIntentId: input.stripePreAuthIntentId ?? null,
    },
  });
}

/**
 * Close the session and return the final row. Idempotent — if the
 * session was already closed, the existing closedAt is preserved
 * rather than overwritten so audit trails stay accurate.
 */
export async function close(jwtJti: string): Promise<ApiSession | null> {
  const existing = await prisma.apiSession.findUnique({ where: { jwtJti } });
  if (!existing) return null;
  if (existing.closedAt) return existing;
  return prisma.apiSession.update({
    where: { jwtJti },
    data: { closedAt: new Date() },
  });
}

export async function findByJti(jwtJti: string): Promise<ApiSession | null> {
  return prisma.apiSession.findUnique({ where: { jwtJti } });
}
