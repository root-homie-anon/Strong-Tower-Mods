/**
 * Repository smoke tests.
 *
 * Runs against the same SQLite database the dev server uses. The
 * tests share a single Prisma client (the module-level singleton) and
 * clean up after themselves with explicit deletes rather than a full
 * `prisma migrate reset` so a parallel `bun run db:studio` session
 * is not disrupted.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { prisma, disconnectPrisma, repositories } from '../src/index.js';

const TEST_NEXUS_USER_ID_BASE = 9_900_000;

/**
 * Each test gets a unique nexusUserId so a partial cleanup failure in
 * one test cannot poison another. The base id is well above any real
 * Nexus user id so collisions with seed data are impossible.
 */
function uniqueNexusUserId(): number {
  return TEST_NEXUS_USER_ID_BASE + Math.floor(Math.random() * 100_000);
}

beforeEach(async () => {
  await prisma.meteredUsage.deleteMany({});
  await prisma.apiSession.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.stripeCustomer.deleteMany({});
  await prisma.nexusIdentity.deleteMany({});
  await prisma.user.deleteMany({});
});

afterAll(async () => {
  await disconnectPrisma();
});

describe('users.upsertFromNexus', () => {
  test('creates User + NexusIdentity atomically on first call', async () => {
    const nexusUserId = uniqueNexusUserId();
    const result = await repositories.users.upsertFromNexus({
      nexusUserId,
      nexusUsername: 'WastelandSurvivor',
      displayName: 'Wasteland Survivor',
      isPremium: true,
    });

    expect(result.id).toBeTruthy();
    expect(result.nexusIsPremium).toBe(true);
    expect(result.nexusIdentity.nexusUserId).toBe(nexusUserId);
    expect(result.nexusIdentity.nexusUsername).toBe('WastelandSurvivor');
  });

  test('is idempotent — second call updates the same row', async () => {
    const nexusUserId = uniqueNexusUserId();
    const first = await repositories.users.upsertFromNexus({
      nexusUserId,
      nexusUsername: 'OldName',
    });
    const second = await repositories.users.upsertFromNexus({
      nexusUserId,
      nexusUsername: 'NewName',
      isPremium: true,
    });

    expect(second.id).toBe(first.id);
    expect(second.nexusIdentity.nexusUsername).toBe('NewName');
    expect(second.nexusIsPremium).toBe(true);

    const userCount = await prisma.user.count();
    expect(userCount).toBe(1);
  });
});

describe('sessions.open / close', () => {
  test('open then close marks closedAt; second close is a no-op', async () => {
    const user = await repositories.users.upsertFromNexus({
      nexusUserId: uniqueNexusUserId(),
      nexusUsername: 'tester',
    });
    const opened = await repositories.sessions.open({
      userId: user.id,
      jwtJti: 'jti-abc',
      tier: 'premium',
    });
    expect(opened.closedAt).toBeNull();

    const closed = await repositories.sessions.close('jti-abc');
    expect(closed?.closedAt).not.toBeNull();
    const closedAt = closed?.closedAt;

    const reClosed = await repositories.sessions.close('jti-abc');
    // Idempotent: the original closedAt is preserved exactly, not
    // overwritten with the second call's timestamp.
    expect(reClosed?.closedAt?.getTime()).toBe(closedAt?.getTime());
  });
});

describe('usage.record', () => {
  test('records a row and denormalizes the session total', async () => {
    const user = await repositories.users.upsertFromNexus({
      nexusUserId: uniqueNexusUserId(),
      nexusUsername: 'metered',
    });
    const session = await repositories.sessions.open({
      userId: user.id,
      jwtJti: 'jti-metered',
      tier: 'custom',
      preAuthAmountMicrodollars: 10_000_000,
    });

    await repositories.usage.record({
      apiSessionId: session.id,
      userId: user.id,
      metric: 'claude_turn',
      quantity: 1,
      costMicrodollars: 12_345,
    });
    await repositories.usage.record({
      apiSessionId: session.id,
      userId: user.id,
      metric: 'claude_turn',
      quantity: 1,
      costMicrodollars: 67_890,
    });

    expect(await repositories.usage.sumForSession(session.id)).toBe(80_235);
  });
});

describe('billing.upsertSubscription', () => {
  test('findActiveForUser returns the active row when one exists', async () => {
    const user = await repositories.users.upsertFromNexus({
      nexusUserId: uniqueNexusUserId(),
      nexusUsername: 'subscriber',
    });
    await repositories.billing.upsertSubscription({
      userId: user.id,
      stripeSubscriptionId: 'sub_test_123',
      tier: 'premium',
      status: 'active',
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    });

    const active = await repositories.billing.findActiveForUser(user.id);
    expect(active?.tier).toBe('premium');
    expect(active?.stripeSubscriptionId).toBe('sub_test_123');
  });

  test('canceled subscription is not returned by findActiveForUser', async () => {
    const user = await repositories.users.upsertFromNexus({
      nexusUserId: uniqueNexusUserId(),
      nexusUsername: 'cancelled',
    });
    await repositories.billing.upsertSubscription({
      userId: user.id,
      stripeSubscriptionId: 'sub_test_456',
      tier: 'basic',
      status: 'canceled',
      currentPeriodStart: new Date('2026-04-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-05-01T00:00:00Z'),
    });

    expect(await repositories.billing.findActiveForUser(user.id)).toBeNull();
  });
});
