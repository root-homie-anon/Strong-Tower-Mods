/**
 * Nexus-API error taxonomy.
 *
 * The upstream package surfaces errors as untyped Error subclasses or
 * raw HTTP rejections. We translate them into a stable taxonomy so
 * Vortex-side handlers and the extension's own retry policy can branch
 * on a single shape regardless of which transport produced the error.
 */

export class NexusApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'NexusApiError';
  }
}

export class NexusAuthError extends NexusApiError {
  constructor(message: string) {
    super('NEXUS_AUTH_ERROR', message, 401);
  }
}

export class NexusRateLimitError extends NexusApiError {
  constructor(message: string) {
    super('NEXUS_RATE_LIMIT', message, 429);
  }
}

export class NexusNotFoundError extends NexusApiError {
  constructor(message: string) {
    super('NEXUS_NOT_FOUND', message, 404);
  }
}

export class NexusUnreachableError extends NexusApiError {
  constructor(message: string) {
    super('NEXUS_UNREACHABLE', message, 503);
  }
}
