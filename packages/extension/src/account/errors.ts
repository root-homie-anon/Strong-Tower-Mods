/**
 * Account-linking errors.
 *
 * Discriminated subclasses so Vortex UI code can branch on the
 * specific failure mode (network blip vs. cloud rejection vs.
 * server-side bug) without parsing message strings.
 */

export class AccountLinkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'AccountLinkError';
  }
}

export class CloudUnreachableError extends AccountLinkError {
  constructor(message: string) {
    super('CLOUD_UNREACHABLE', message, 503);
  }
}

export class CloudRejectedError extends AccountLinkError {
  constructor(message: string, statusCode: number) {
    super('CLOUD_REJECTED', message, statusCode);
  }
}
