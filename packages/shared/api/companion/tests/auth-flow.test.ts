/**
 * In-process integration test for the real auth + billing path.
 *
 * Exercises the same call chain a /session/open → WS upgrade →
 * /session/close would, but without standing up a Fastify HTTP server
 * — that path is covered by manual end-to-end testing once Nexus SSO
 * is approved.
 *
 * What we prove here:
 *   1. issueSessionToken + the corresponding ApiSession row are paired
 *      on the same jti, so verifyTurnAuth() succeeds.
 *   2. A closed ApiSession causes verifyTurnAuth() to fail loudly
 *      rather than silently allowing usage on a stale token.
 *   3. usage.record + ApiSession.meteredTotalMicrodollars stay in sync
 *      across multiple turns.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { prisma, disconnectPrisma, repositories } from '@strong-tower/db';
import { jwt as authJwt } from '@strong-tower/auth';
import { customers, _resetStripeClientForTests } from '@strong-tower/billing';
import { verifyTurnAuth, TurnAuthError } from '../src/auth.js';

beforeAll(() => {
  process.env['JWT_SECRET'] = 'auth-flow-test-secret-at-least-32-chars-long';
  process.env['STRIPE_MOCK'] = 'true';
  process.env['NEXUS_SSO_MOCK'] = 'true';
  // CRITICAL: leave AUTH_MOCK unset so verifyTurnAuth takes the real path.
  delete process.env['AUTH_MOCK'];
  _resetStripeClientForTests();
});

afterAll(async () => {
  delete process.env['JWT_SECRET'];
  delete process.env['STRIPE_MOCK'];
  delete process.env['NEXUS_SSO_MOCK'];
  await disconnectPrisma();
});

beforeEach(async () => {
  await prisma.meteredUsage.deleteMany({});
  await prisma.apiSession.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.stripeCustomer.deleteMany({});
  await prisma.nexusIdentity.deleteMany({});
  await prisma.user.deleteMany({});
});

/**
 * Drives the same path POST /session/open follows: materialise the
 * Nexus user, create the Stripe customer, mint the JWT, open the
 * ApiSession. Returns the artifacts a real WS client would receive.
 */
async function openSession(tier: string = 'premium') {
  const nexusUserId = 100_000 + Math.floor(Math.random() * 900_000);
  const user = await repositories.users.upsertFromNexus({
    nexusUserId,
    nexusUsername: `tester-${nexusUserId}`,
  });
  await customers.getOrCreate({ userId: user.id, nexusUserId });

  const issued = await authJwt.issueSessionToken({ userId: user.id, tier });
  const session = await repositories.sessions.open({
    userId: user.id,
    jwtJti: issued.jti,
    tier,
  });

  return { user, session, token: issued.token, jti: issued.jti };
}

describe('verifyTurnAuth (real mode)', () => {
  test('accepts a freshly-minted JWT bound to an open ApiSession', async () => {
    const { user, jti, token } = await openSession('premium');

    const ctx = await verifyTurnAuth(token);
    expect(ctx.mock).toBe(false);
    expect(ctx.userId).toBe(user.id);
    expect(ctx.jti).toBe(jti);
    expect(ctx.tier).toBe('premium');
  });

  test('rejects a token whose ApiSession has been closed', async () => {
    const { token, jti } = await openSession('premium');

    await repositories.sessions.close(jti);

    await expect(verifyTurnAuth(token)).rejects.toThrow(TurnAuthError);
  });

  test('rejects a missing or empty token', async () => {
    await expect(verifyTurnAuth(null)).rejects.toThrow(TurnAuthError);
    await expect(verifyTurnAuth('')).rejects.toThrow(TurnAuthError);
  });

  test('rejects a token whose ApiSession was never persisted (orphan jti)', async () => {
    const issued = await authJwt.issueSessionToken({
      userId: 'user-that-does-not-exist',
      tier: 'premium',
    });
    await expect(verifyTurnAuth(issued.token)).rejects.toThrow(TurnAuthError);
  });
});

describe('usage recording end-to-end', () => {
  test('multiple recorded turns accumulate on the ApiSession total', async () => {
    const { user, session } = await openSession('premium');

    await repositories.usage.record({
      apiSessionId: session.id,
      userId: user.id,
      metric: 'claude_turn',
      quantity: 1,
      costMicrodollars: 4_500,
    });
    await repositories.usage.record({
      apiSessionId: session.id,
      userId: user.id,
      metric: 'claude_turn',
      quantity: 1,
      costMicrodollars: 3_200,
    });
    await repositories.usage.record({
      apiSessionId: session.id,
      userId: user.id,
      metric: 'claude_turn',
      quantity: 1,
      costMicrodollars: 12_100,
    });

    const updated = await repositories.sessions.findByJti(session.jwtJti);
    expect(updated?.meteredTotalMicrodollars).toBe(19_800);

    // Cross-check via the aggregate query path the billing layer
    // uses for month-to-date enforcement.
    expect(await repositories.usage.sumForSession(session.id)).toBe(19_800);
  });
});
