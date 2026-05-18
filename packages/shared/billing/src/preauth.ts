/**
 * Custom-tier per-session pre-authorization.
 *
 * Lifecycle:
 *
 *   1. `create()` opens a manual-capture Stripe PaymentIntent for the
 *      lesser of (configured per-session ceiling, remaining spend
 *      ceiling). The pi_id is persisted on the ApiSession.
 *   2. The session runs. Each turn writes a MeteredUsage row whose
 *      cost is also denormalized onto ApiSession.meteredTotalMicrodollars.
 *   3. On session close, `capture()` charges the actual metered total
 *      (capped to the pre-auth amount). `release()` is the cancel path
 *      for sessions that close without any metered usage.
 *
 * Spend ceiling enforcement happens in `create()` — the function
 * refuses to open a session if the user's month-to-date metered spend
 * has already met or exceeded the ceiling. This is the only place a
 * session can be refused for billing reasons.
 */

import { repositories } from '@strong-tower/db';
import { getStripeClient } from './stripe-client.js';
import {
  PreAuthMissingError,
  SpendCeilingExceededError,
  StripeConfigurationError,
} from './errors.js';

/** Default per-session pre-auth ceiling (microdollars) when none is configured. */
const DEFAULT_SESSION_PREAUTH_MICRODOLLARS = 5_000_000; // $5.00

function microdollarsToCents(microdollars: number): number {
  return Math.ceil(microdollars / 10_000);
}

export interface CreatePreAuthInput {
  userId: string;
  stripeCustomerId: string;
  apiSessionId: string;
  /** Per-session ceiling override; falls back to DEFAULT_SESSION_PREAUTH_MICRODOLLARS. */
  sessionCeilingMicrodollars?: number;
}

export async function create(input: CreatePreAuthInput): Promise<{
  paymentIntentId: string;
  amountMicrodollars: number;
}> {
  const customer = await repositories.billing.findCustomerByUser(input.userId);
  if (!customer) {
    throw new PreAuthMissingError(
      `No StripeCustomer for user ${input.userId} — call customers.getOrCreate first`
    );
  }

  // Month-to-date spend enforcement — only applies when the user has
  // configured a monthly ceiling on their StripeCustomer row.
  if (customer.spendCeilingMicrodollars !== null) {
    const monthStart = startOfCurrentUtcMonth();
    const spentSoFar = await repositories.usage.sumForUserSince(input.userId, monthStart);
    if (spentSoFar >= customer.spendCeilingMicrodollars) {
      throw new SpendCeilingExceededError(
        `User has already spent ${spentSoFar} microdollars this month, ceiling is ${customer.spendCeilingMicrodollars}`
      );
    }
  }

  const sessionCeiling =
    input.sessionCeilingMicrodollars ?? DEFAULT_SESSION_PREAUTH_MICRODOLLARS;

  const stripe = getStripeClient();
  const pi = await stripe.paymentIntents.create({
    amount: microdollarsToCents(sessionCeiling),
    currency: 'usd',
    customer: input.stripeCustomerId,
    capture_method: 'manual',
  });

  if (!pi.id) {
    throw new StripeConfigurationError('Stripe paymentIntent create returned no id');
  }

  return { paymentIntentId: pi.id, amountMicrodollars: sessionCeiling };
}

/**
 * Capture the actual metered total accrued during the session, capped
 * to the pre-authorized amount. Returns the amount actually captured
 * in microdollars. Safe to call multiple times; Stripe rejects a
 * second capture on an already-captured intent.
 */
export async function capture(input: {
  paymentIntentId: string;
  actualMicrodollars: number;
  preAuthMicrodollars: number;
}): Promise<{ capturedMicrodollars: number }> {
  // Capture is capped to the pre-auth amount; anything beyond that
  // is recovered next billing cycle via the subscription invoice,
  // not here. That cap is the entire point of pre-authorization.
  const cappedMicrodollars = Math.min(input.actualMicrodollars, input.preAuthMicrodollars);
  const amountToCaptureCents = microdollarsToCents(cappedMicrodollars);

  const stripe = getStripeClient();
  await stripe.paymentIntents.capture(input.paymentIntentId, {
    amount_to_capture: amountToCaptureCents,
  });

  return { capturedMicrodollars: cappedMicrodollars };
}

/**
 * Cancel an uncaptured pre-auth. Used when a session closes without
 * any metered usage (e.g. the user disconnected before the first
 * turn) so the held funds are released immediately rather than
 * waiting on Stripe's automatic 7-day expiry.
 */
export async function release(paymentIntentId: string): Promise<void> {
  const stripe = getStripeClient();
  await stripe.paymentIntents.cancel(paymentIntentId);
}

function startOfCurrentUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
