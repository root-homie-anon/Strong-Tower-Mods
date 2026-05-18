/**
 * Stripe customer materialisation.
 *
 * Get-or-create is idempotent: we look up an existing
 * StripeCustomer row by userId before calling Stripe. The Nexus user
 * id is written into Stripe metadata so a Stripe dashboard search
 * can reverse-resolve to a user without going through our DB.
 */

import { repositories } from '@strong-tower/db';
import { getStripeClient } from './stripe-client.js';
import { StripeConfigurationError } from './errors.js';

export interface GetOrCreateInput {
  userId: string;
  /** Cached on the StripeCustomer row; used as Custom-tier spend cap. */
  spendCeilingMicrodollars?: number;
  /** Nexus user id, written to Stripe metadata for reverse lookup. */
  nexusUserId?: number;
}

export async function getOrCreate(input: GetOrCreateInput): Promise<{
  stripeCustomerId: string;
}> {
  const existing = await repositories.billing.findCustomerByUser(input.userId);
  if (existing) {
    return { stripeCustomerId: existing.stripeCustomerId };
  }

  const stripe = getStripeClient();
  const metadata: Record<string, string> = { user_id: input.userId };
  if (input.nexusUserId !== undefined) {
    metadata['nexus_user_id'] = String(input.nexusUserId);
  }

  const customer = await stripe.customers.create({ metadata });
  if (!customer.id) {
    throw new StripeConfigurationError('Stripe customer create returned no id');
  }

  const persistInput: {
    userId: string;
    stripeCustomerId: string;
    spendCeilingMicrodollars?: number;
  } = {
    userId: input.userId,
    stripeCustomerId: customer.id,
  };
  if (input.spendCeilingMicrodollars !== undefined) {
    persistInput.spendCeilingMicrodollars = input.spendCeilingMicrodollars;
  }

  await repositories.billing.upsertCustomer(persistInput);

  return { stripeCustomerId: customer.id };
}
