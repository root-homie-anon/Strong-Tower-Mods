/**
 * Repository barrel. Each module wraps a single aggregate root
 * (User, ApiSession, MeteredUsage, ...) with domain-meaningful
 * methods. Call sites should never reach into PrismaClient directly —
 * if you find yourself needing a new query, add it here.
 */

export * as users from './users.js';
export * as sessions from './sessions.js';
export * as usage from './usage.js';
export * as billing from './billing.js';
