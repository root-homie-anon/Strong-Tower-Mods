/**
 * Public entry point for @strong-tower/billing.
 *
 * The billing surface is organized around three flows:
 *
 *   1. Customer materialisation       ─ `customers.getOrCreate(user)`
 *   2. Subscription lifecycle         ─ `subscriptions.{create,cancel,sync}`
 *   3. Custom-tier per-session billing ─ `preauth.{create,capture,release}`
 *
 * Stripe is the source of truth. Our DB caches the customer / subscription
 * rows for fast attribution; `webhooks.handle(...)` keeps the cache in
 * sync from Stripe-side mutations (admin refunds, dunning, etc.).
 *
 * Mock mode (STRIPE_MOCK=true) returns plausibly-shaped Stripe IDs and
 * never touches the network, so the full stack — including pre-auth +
 * spend ceiling enforcement — can be exercised end-to-end before the
 * Stripe account is provisioned.
 */

export { TIER_CATALOG, type BillingTier, getTierConfig } from './tiers.js';
export * as customers from './customers.js';
export * as subscriptions from './subscriptions.js';
export * as preauth from './preauth.js';
export * as webhooks from './webhooks.js';
export {
  BillingError,
  SpendCeilingExceededError,
  PreAuthMissingError,
  StripeConfigurationError,
  WebhookSignatureError,
} from './errors.js';

/**
 * Test-only helper — resets the cached Stripe client so a test that
 * flips STRIPE_MOCK after import time picks up the new mode. Not part
 * of the package's runtime contract; downstream packages should never
 * call this outside test setup.
 */
export { _resetStripeClientForTests } from './stripe-client.js';
