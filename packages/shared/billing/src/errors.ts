/**
 * Billing-domain errors.
 *
 * Each error carries an HTTP-friendly statusCode so the cloud API can
 * translate to a response without an instanceof ladder per handler.
 */

export class BillingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export class SpendCeilingExceededError extends BillingError {
  constructor(message: string) {
    super('SPEND_CEILING_EXCEEDED', message, 402);
  }
}

export class PreAuthMissingError extends BillingError {
  constructor(message: string) {
    super('PREAUTH_MISSING', message, 402);
  }
}

export class StripeConfigurationError extends BillingError {
  constructor(message: string) {
    super('STRIPE_CONFIGURATION_ERROR', message, 500);
  }
}

export class WebhookSignatureError extends BillingError {
  constructor(message: string) {
    super('WEBHOOK_SIGNATURE_ERROR', message, 400);
  }
}
