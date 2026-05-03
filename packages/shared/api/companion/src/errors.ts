export class CompanionApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'CompanionApiError';
  }
}

export class ValidationError extends CompanionApiError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
  }
}

export class AuthError extends CompanionApiError {
  constructor(message: string) {
    super('AUTH_ERROR', message, 401);
    this.name = 'AuthError';
  }
}

export class UpstreamAuthError extends CompanionApiError {
  constructor(message: string) {
    super('UPSTREAM_AUTH_ERROR', message, 502);
    this.name = 'UpstreamAuthError';
  }
}

export class RateLimitedError extends CompanionApiError {
  constructor(message: string) {
    super('RATE_LIMITED', message, 429);
    this.name = 'RateLimitedError';
  }
}

export class UpstreamFailedError extends CompanionApiError {
  constructor(message: string) {
    super('UPSTREAM_FAILED', message, 502);
    this.name = 'UpstreamFailedError';
  }
}

export class UpstreamUnreachableError extends CompanionApiError {
  constructor(message: string) {
    super('UPSTREAM_UNREACHABLE', message, 503);
    this.name = 'UpstreamUnreachableError';
  }
}

export class TurnLimitReachedError extends CompanionApiError {
  constructor(message: string) {
    super('TURN_LIMIT_REACHED', message, 429);
    this.name = 'TurnLimitReachedError';
  }
}
