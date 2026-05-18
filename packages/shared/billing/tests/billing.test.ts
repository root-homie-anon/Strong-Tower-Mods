/**
 * End-to-end mock-mode tests for the billing surface.
 *
 * All Stripe calls go through the mock client so the suite has no
 * network dependency and no live charges. Every test resets the
 * shared DB state in beforeEach so the order of test execution
 * cannot leak rows between cases.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { prisma, disconnectPrisma, repositories } from '@strong-tower/db';
import {
  customers,
  subscriptions,
  preauth,
  webhooks,
  TIER_CATALOG,
  getTierConfig,
  SpendCeilingExceededError,
  WebhookSignatureError,
} from '../src/index.js';
import { _resetStripeClientForTests } from '../src/stripe-client.js';

beforeAll(() => {
  process.env['STRIPE_MOCK'] = 'true';
  _resetStripeClientForTests();
});

afterAll(async () => {
  delete process.env['STRIPE_MOCK'];
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

async function seedUser(overrides: { spendCeilingMicrodollars?: number } = {}) {
  const user = await repositories.users.upsertFromNexus({
    nexusUserId: 12345 + Math.floor(Math.random() * 1_000_000),
    nexusUsername: 'tester',
  });
  const created = await customers.getOrCreate({
    userId: user.id,
    nexusUserId: 12345,
    ...(overrides.spendCeilingMicrodollars !== undefined
      ? { spendCeilingMicrodollars: overrides.spendCeilingMicrodollars }
      : {}),
  });
  return { user, stripeCustomerId: created.stripeCustomerId };
}

describe('tiers', () => {
  test('TIER_CATALOG covers every documented tier with finite pricing', () => {
    for (const tier of Object.keys(TIER_CATALOG)) {
      const config = getTierConfig(tier);
      expect(config.monthlyFeeMicrodollars).toBeGreaterThanOrEqual(0);
    }
  });

  test('only the custom tiers require pre-authorization', () => {
    expect(TIER_CATALOG.basic.requiresPreAuth).toBe(false);
    expect(TIER_CATALOG.premium.requiresPreAuth).toBe(false);
    expect(TIER_CATALOG.custom.requiresPreAuth).toBe(true);
    expect(TIER_CATALOG.bundle_custom_creator.requiresPreAuth).toBe(true);
  });
});

describe('customers.getOrCreate', () => {
  test('creates a Stripe customer and persists the StripeCustomer row', async () => {
    const { user, stripeCustomerId } = await seedUser();
    expect(stripeCustomerId).toMatch(/^cus_mock_/);

    const persisted = await repositories.billing.findCustomerByUser(user.id);
    expect(persisted?.stripeCustomerId).toBe(stripeCustomerId);
  });

  test('is idempotent — second call returns the same customer id', async () => {
    const { user, stripeCustomerId } = await seedUser();
    const second = await customers.getOrCreate({ userId: user.id });
    expect(second.stripeCustomerId).toBe(stripeCustomerId);
  });
});

describe('subscriptions.create', () => {
  test('creates a subscription and persists it as active', async () => {
    const { user, stripeCustomerId } = await seedUser();
    const result = await subscriptions.create({
      userId: user.id,
      stripeCustomerId,
      tier: 'premium',
    });
    expect(result.stripeSubscriptionId).toMatch(/^sub_mock_/);

    const active = await repositories.billing.findActiveForUser(user.id);
    expect(active?.tier).toBe('premium');
    expect(active?.status).toBe('active');
  });
});

describe('preauth.create', () => {
  test('opens a manual-capture PaymentIntent for the configured ceiling', async () => {
    const { user, stripeCustomerId } = await seedUser();
    const session = await repositories.sessions.open({
      userId: user.id,
      jwtJti: 'jti-preauth-1',
      tier: 'custom',
    });
    const result = await preauth.create({
      userId: user.id,
      stripeCustomerId,
      apiSessionId: session.id,
      sessionCeilingMicrodollars: 2_500_000,
    });
    expect(result.paymentIntentId).toMatch(/^pi_mock_/);
    expect(result.amountMicrodollars).toBe(2_500_000);
  });

  test('refuses when month-to-date spend exceeds the ceiling', async () => {
    const { user, stripeCustomerId } = await seedUser({
      spendCeilingMicrodollars: 1_000_000, // $1.00
    });
    const session = await repositories.sessions.open({
      userId: user.id,
      jwtJti: 'jti-spent-out',
      tier: 'custom',
    });
    // Burn through the ceiling before opening a pre-auth.
    await repositories.usage.record({
      apiSessionId: session.id,
      userId: user.id,
      metric: 'claude_turn',
      quantity: 1,
      costMicrodollars: 1_500_000,
    });

    await expect(
      preauth.create({
        userId: user.id,
        stripeCustomerId,
        apiSessionId: session.id,
      })
    ).rejects.toThrow(SpendCeilingExceededError);
  });
});

describe('preauth.capture', () => {
  test('captures the actual metered total, never above the pre-auth ceiling', async () => {
    const { capturedMicrodollars } = await preauth.capture({
      paymentIntentId: 'pi_mock_capture',
      actualMicrodollars: 8_000_000,
      preAuthMicrodollars: 5_000_000,
    });
    expect(capturedMicrodollars).toBe(5_000_000);
  });

  test('captures the actual amount when it is under the ceiling', async () => {
    const { capturedMicrodollars } = await preauth.capture({
      paymentIntentId: 'pi_mock_under',
      actualMicrodollars: 1_234_567,
      preAuthMicrodollars: 5_000_000,
    });
    expect(capturedMicrodollars).toBe(1_234_567);
  });
});

describe('webhooks.handle', () => {
  test('upserts a subscription row from customer.subscription.updated', async () => {
    const { user } = await seedUser();
    const now = Math.floor(Date.now() / 1000);
    const event = {
      id: 'evt_test_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test_webhook',
          customer: 'cus_mock_x',
          status: 'active',
          current_period_start: now,
          current_period_end: now + 30 * 24 * 60 * 60,
          cancel_at_period_end: false,
          metadata: { user_id: user.id, tier: 'premium' },
        },
      },
    };

    const result = await webhooks.handle({
      rawBody: JSON.stringify(event),
      signatureHeader: 'mock-sig-not-verified',
    });
    expect(result.handled).toBe(true);
    expect(result.eventId).toBe('evt_test_1');

    const active = await repositories.billing.findActiveForUser(user.id);
    expect(active?.tier).toBe('premium');
  });

  test('rejects when a real-mode call arrives without a signature', async () => {
    delete process.env['STRIPE_MOCK'];
    _resetStripeClientForTests();
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy';
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_dummy';

    await expect(
      webhooks.handle({ rawBody: '{}', signatureHeader: null })
    ).rejects.toThrow(WebhookSignatureError);

    delete process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    process.env['STRIPE_MOCK'] = 'true';
    _resetStripeClientForTests();
  });
});
