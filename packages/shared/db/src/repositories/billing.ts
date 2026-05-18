/**
 * StripeCustomer + Subscription repository.
 *
 * Stripe is the source of truth for billing state — these rows are
 * caches whose primary purpose is fast attribution from a JWT to the
 * subscription tier without hitting the Stripe API on every request.
 * Webhook handlers in @strong-tower/billing keep them in sync.
 */

import type { StripeCustomer, Subscription } from '../../prisma-client/index.js';
import { prisma } from '../client.js';

export interface UpsertCustomerInput {
  userId: string;
  stripeCustomerId: string;
  defaultPaymentMethodId?: string;
  /** Custom-tier monthly spend ceiling (microdollars). */
  spendCeilingMicrodollars?: number;
}

export async function upsertCustomer(
  input: UpsertCustomerInput
): Promise<StripeCustomer> {
  return prisma.stripeCustomer.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      stripeCustomerId: input.stripeCustomerId,
      defaultPaymentMethodId: input.defaultPaymentMethodId ?? null,
      spendCeilingMicrodollars: input.spendCeilingMicrodollars ?? null,
    },
    update: {
      stripeCustomerId: input.stripeCustomerId,
      defaultPaymentMethodId: input.defaultPaymentMethodId ?? null,
      spendCeilingMicrodollars: input.spendCeilingMicrodollars ?? null,
    },
  });
}

export async function findCustomerByUser(
  userId: string
): Promise<StripeCustomer | null> {
  return prisma.stripeCustomer.findUnique({ where: { userId } });
}

export interface UpsertSubscriptionInput {
  userId: string;
  stripeSubscriptionId: string;
  tier: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd?: boolean;
}

export async function upsertSubscription(
  input: UpsertSubscriptionInput
): Promise<Subscription> {
  return prisma.subscription.upsert({
    where: { stripeSubscriptionId: input.stripeSubscriptionId },
    create: {
      userId: input.userId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      tier: input.tier,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    },
    update: {
      tier: input.tier,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    },
  });
}

/**
 * Find the currently-active subscription for a user, if any. Returns
 * the most recently-started active row when more than one exists
 * (which should not happen in production but can during testing).
 */
export async function findActiveForUser(
  userId: string
): Promise<Subscription | null> {
  return prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ['active', 'trialing'] },
    },
    orderBy: { currentPeriodStart: 'desc' },
  });
}
