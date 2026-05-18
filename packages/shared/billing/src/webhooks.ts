/**
 * Stripe webhook dispatcher.
 *
 * Real Stripe webhooks must be HMAC-verified using the
 * stripe-signature header before any handler runs — a missing or
 * mismatched signature surfaces as ``WebhookSignatureError`` (HTTP 400).
 *
 * Mock mode skips signature verification so tests can feed synthetic
 * events without the test runner needing to compute a valid HMAC.
 */

import { repositories } from '@strong-tower/db';
import { getStripeClient, isMockMode } from './stripe-client.js';
import { WebhookSignatureError, StripeConfigurationError } from './errors.js';

interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verify the payload signature and dispatch to the appropriate
 * handler. Returns the event id so the caller can persist it for
 * idempotency on retries.
 */
export async function handle(input: {
  rawBody: string | Buffer;
  signatureHeader: string | null;
}): Promise<{ eventId: string; type: string; handled: boolean }> {
  if (!isMockMode()) {
    if (!input.signatureHeader) {
      throw new WebhookSignatureError('Missing stripe-signature header');
    }
    const secret = process.env['STRIPE_WEBHOOK_SECRET'];
    if (!secret) {
      throw new StripeConfigurationError('STRIPE_WEBHOOK_SECRET not set');
    }
  }

  const stripe = getStripeClient();
  let event: StripeEventLike;
  try {
    const secret = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
    event = stripe.webhooks.constructEvent(
      input.rawBody,
      input.signatureHeader ?? '',
      secret
    ) as StripeEventLike;
  } catch (err) {
    throw new WebhookSignatureError(
      `Stripe webhook signature verification failed: ${(err as Error).message}`
    );
  }

  const handled = await dispatch(event);
  return { eventId: event.id, type: event.type, handled };
}

async function dispatch(event: StripeEventLike): Promise<boolean> {
  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.created':
      return handleSubscriptionUpsert(event);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event);
    default:
      // Unhandled event types are not errors — Stripe sends a lot,
      // and we only care about the ones we explicitly subscribed to.
      return false;
  }
}

interface WebhookSubscriptionShape {
  id: string;
  customer?: string;
  status: string;
  // Stripe API 2025-09-30.clover and later: period fields are
  // per-item. Older payloads (pre-2025-09-30 webhooks) may still send
  // them at the top level — we accept either to stay forward + backward
  // compatible across the Stripe API version pin.
  current_period_start?: number;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_start?: number; current_period_end?: number }> };
  cancel_at_period_end: boolean;
  metadata?: Record<string, string>;
}

function extractWebhookPeriod(sub: WebhookSubscriptionShape): { start: Date; end: Date } {
  const itemStart = sub.items?.data?.[0]?.current_period_start;
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  const start = itemStart ?? sub.current_period_start;
  const end = itemEnd ?? sub.current_period_end;
  if (start === undefined || end === undefined) {
    throw new StripeConfigurationError(
      'Webhook subscription payload missing current_period_{start,end} at both top-level and items[0]'
    );
  }
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

async function handleSubscriptionUpsert(event: StripeEventLike): Promise<boolean> {
  const sub = event.data.object as unknown as WebhookSubscriptionShape;
  const userId = sub.metadata?.['user_id'];
  const tier = sub.metadata?.['tier'];
  if (!userId || !tier) {
    // We require explicit metadata on every subscription we create.
    // A subscription without it means an admin-side creation that
    // should not be synced automatically — surface and log, do not
    // throw, because Stripe will retry on any non-2xx response.
    return false;
  }

  const period = extractWebhookPeriod(sub);
  await repositories.billing.upsertSubscription({
    userId,
    stripeSubscriptionId: sub.id,
    tier,
    status: sub.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
  return true;
}

async function handleSubscriptionDeleted(event: StripeEventLike): Promise<boolean> {
  const sub = event.data.object as unknown as WebhookSubscriptionShape;
  const userId = sub.metadata?.['user_id'];
  const tier = sub.metadata?.['tier'];
  if (!userId || !tier) return false;

  const period = extractWebhookPeriod(sub);
  await repositories.billing.upsertSubscription({
    userId,
    stripeSubscriptionId: sub.id,
    tier,
    status: 'canceled',
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
  return true;
}
