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
