/**
 * Subscription lifecycle.
 *
 * The Stripe price id for each tier is provided via env vars
 * (STRIPE_PRICE_BASIC, STRIPE_PRICE_PREMIUM, ...) so the same code
 * runs against the Stripe sandbox and production without recompiling.
 * Mock mode bypasses the price-id lookup and writes deterministic
 * fake ids.
 */

import { repositories } from '@strong-tower/db';
import { getStripeClient, isMockMode } from './stripe-client.js';
import { getTierConfig, type BillingTier } from './tiers.js';
import { StripeConfigurationError } from './errors.js';

/**
 * Extract the current billing period from a Stripe Subscription. As of
 * Stripe API 2025-09-30.clover, the period fields moved off the top
 * level of Subscription onto the per-item level (Subscription.items.data[i]).
 * Our mock client mirrors that shape, so a single accessor handles
 * both code paths.
 */
function extractPeriod(sub: { items?: { data?: Array<{ current_period_start?: number; current_period_end?: number }> } }): {
  start: Date;
  end: Date;
} {
  const item = sub.items?.data?.[0];
  const start = item?.current_period_start;
  const end = item?.current_period_end;
  if (start === undefined || end === undefined) {
    throw new StripeConfigurationError(
      'Stripe subscription missing items[0].current_period_{start,end}'
    );
  }
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

function envPriceId(tier: BillingTier): string {
  if (isMockMode()) return `price_mock_${tier}`;
  const envKey = `STRIPE_PRICE_${tier.toUpperCase()}`;
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new StripeConfigurationError(
      `Stripe price id not configured for tier ${tier} (set ${envKey})`
    );
  }
  return priceId;
}

export async function create(input: {
  userId: string;
  stripeCustomerId: string;
  tier: BillingTier;
}): Promise<{ stripeSubscriptionId: string; tier: BillingTier }> {
  // Validate the tier exists. Throws on unknown tier.
  getTierConfig(input.tier);

  const stripe = getStripeClient();
  const sub = await stripe.subscriptions.create({
    customer: input.stripeCustomerId,
    items: [{ price: envPriceId(input.tier) }],
  });

  const period = extractPeriod(sub);
  await repositories.billing.upsertSubscription({
    userId: input.userId,
    stripeSubscriptionId: sub.id,
    tier: input.tier,
    status: sub.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });

  return { stripeSubscriptionId: sub.id, tier: input.tier };
}

export async function cancel(input: {
  userId: string;
  stripeSubscriptionId: string;
  tier: BillingTier;
}): Promise<void> {
  const stripe = getStripeClient();
  const sub = await stripe.subscriptions.cancel(input.stripeSubscriptionId);

  const period = extractPeriod(sub);
  await repositories.billing.upsertSubscription({
    userId: input.userId,
    stripeSubscriptionId: sub.id,
    tier: input.tier,
    status: sub.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}
