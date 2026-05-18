/**
 * Stripe SDK singleton with a deterministic mock client.
 *
 * Mock mode (STRIPE_MOCK=true) is a Proxy-backed object that returns
 * plausibly-shaped IDs and no-ops for every Stripe API call we make.
 * It is intentionally narrow — only the surface area used by this
 * package is mocked, and any new Stripe call must be added to the
 * dispatch table here so unexpected network access is impossible by
 * construction.
 *
 * The mock IDs are prefixed with mock_ so an accidental leak into a
 * production system is immediately visible in Stripe-dashboard logs
 * and alerting.
 */

import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import { StripeConfigurationError } from './errors.js';

// Mock mode is checked at every getStripeClient() call rather than at
// module load — tests use beforeAll to toggle STRIPE_MOCK after imports
// have already evaluated, so a module-level constant would freeze the
// wrong value. The production guard fires from the same accessor for
// the same reason.
function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

function mockId(prefix: string): string {
  return `${prefix}_mock_${randomBytes(8).toString('hex')}`;
}

interface MockStripeClient {
  customers: {
    create: (params: { metadata?: Record<string, string> }) => Promise<{ id: string }>;
    retrieve: (id: string) => Promise<{ id: string; deleted?: boolean }>;
  };
  subscriptions: {
    create: (params: {
      customer: string;
      items: Array<{ price: string }>;
    }) => Promise<MockSubscription>;
    cancel: (id: string) => Promise<MockSubscription>;
    retrieve: (id: string) => Promise<MockSubscription>;
  };
  paymentIntents: {
    create: (params: {
      amount: number;
      currency: string;
      customer: string;
      capture_method: 'manual' | 'automatic';
    }) => Promise<MockPaymentIntent>;
    capture: (id: string, params?: { amount_to_capture?: number }) => Promise<MockPaymentIntent>;
    cancel: (id: string) => Promise<MockPaymentIntent>;
  };
  webhooks: {
    constructEvent: (rawBody: string | Buffer, sig: string, secret: string) => unknown;
  };
}

interface MockSubscription {
  id: string;
  status: 'active';
  // Stripe v19 moved billing period to the per-item level. We mirror
  // that on the mock so the extractor in subscriptions.ts has one
  // code path regardless of whether it is reading the real SDK or the
  // mock.
  items: { data: Array<{ current_period_start: number; current_period_end: number }> };
  cancel_at_period_end: boolean;
}

interface MockPaymentIntent {
  id: string;
  status: 'requires_capture' | 'succeeded' | 'canceled';
  amount: number;
  amount_capturable: number;
  amount_received: number;
  currency: string;
  customer: string;
}

function buildMockClient(): MockStripeClient {
  return {
    customers: {
      create: async (_params) => ({ id: mockId('cus') }),
      retrieve: async (id) => ({ id }),
    },
    subscriptions: {
      create: async (_params) => {
        const now = Math.floor(Date.now() / 1000);
        return {
          id: mockId('sub'),
          status: 'active',
          items: {
            data: [{ current_period_start: now, current_period_end: now + 30 * 24 * 60 * 60 }],
          },
          cancel_at_period_end: false,
        };
      },
      cancel: async (id) => {
        const now = Math.floor(Date.now() / 1000);
        return {
          id,
          status: 'active',
          items: {
            data: [{ current_period_start: now, current_period_end: now + 30 * 24 * 60 * 60 }],
          },
          cancel_at_period_end: true,
        };
      },
      retrieve: async (id) => {
        const now = Math.floor(Date.now() / 1000);
        return {
          id,
          status: 'active',
          items: {
            data: [{ current_period_start: now, current_period_end: now + 30 * 24 * 60 * 60 }],
          },
          cancel_at_period_end: false,
        };
      },
    },
    paymentIntents: {
      create: async (params) => ({
        id: mockId('pi'),
        status: 'requires_capture',
        amount: params.amount,
        amount_capturable: params.amount,
        amount_received: 0,
        currency: params.currency,
        customer: params.customer,
      }),
      capture: async (id, params) => ({
        id,
        status: 'succeeded',
        amount: params?.amount_to_capture ?? 0,
        amount_capturable: 0,
        amount_received: params?.amount_to_capture ?? 0,
        currency: 'usd',
        customer: 'cus_mock',
      }),
      cancel: async (id) => ({
        id,
        status: 'canceled',
        amount: 0,
        amount_capturable: 0,
        amount_received: 0,
        currency: 'usd',
        customer: 'cus_mock',
      }),
    },
    webhooks: {
      constructEvent: (rawBody, _sig, _secret) => {
        // Mock mode trusts the body completely. The real client uses
        // HMAC verification via the stripe-signature header.
        if (typeof rawBody === 'string') return JSON.parse(rawBody);
        return JSON.parse(rawBody.toString('utf-8'));
      },
    },
  };
}

function buildRealClient(): Stripe {
  const apiKey = process.env['STRIPE_SECRET_KEY'];
  if (!apiKey) {
    throw new StripeConfigurationError(
      'STRIPE_SECRET_KEY is not set and STRIPE_MOCK is not "true"'
    );
  }
  return new Stripe(apiKey, {
    // Pin the API version so a Stripe-side breaking change does not
    // surprise us in production. Bump explicitly after testing.
    apiVersion: '2025-10-29.clover',
  });
}

// The exported type is the intersection of real + mock surfaces our
// code uses, expressed as the real Stripe type because we always
// access the same method names. The mock satisfies this shape via
// structural typing.
export type StripeLike = MockStripeClient | Stripe;

let _client: StripeLike | null = null;
let _clientMode: 'mock' | 'real' | null = null;

export function getStripeClient(): StripeLike {
  const currentMode: 'mock' | 'real' = isMockMode() ? 'mock' : 'real';
  // Invalidate the cached client if STRIPE_MOCK has flipped since the
  // last call. Without this, a test that toggles STRIPE_MOCK between
  // cases would silently reuse the wrong client.
  if (_client && _clientMode === currentMode) return _client;

  if (currentMode === 'mock' && isProduction()) {
    throw new StripeConfigurationError(
      'STRIPE_MOCK=true is forbidden when NODE_ENV=production'
    );
  }
  _client = currentMode === 'mock' ? buildMockClient() : buildRealClient();
  _clientMode = currentMode;
  return _client;
}

/**
 * Test helper — reset the cached client so a test can flip
 * STRIPE_MOCK after import-time evaluation. The runtime mode check
 * also covers this automatically, but tests that want a fresh client
 * for assertion purposes can call this explicitly.
 */
export function _resetStripeClientForTests(): void {
  _client = null;
  _clientMode = null;
}

export const isMockMode = (): boolean => process.env['STRIPE_MOCK'] === 'true';
