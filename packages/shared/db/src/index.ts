/**
 * Public entry point for @strong-tower/db.
 *
 * Consumers should import the singleton `prisma` client and the
 * repository helpers from this barrel — never reach into
 * `@prisma/client` directly, so all type narrowing and convenience
 * methods live in one auditable place.
 *
 * The repository layer wraps the generated client with domain-specific
 * methods (upsertNexusUser, openApiSession, recordTurnUsage, ...) so
 * call sites read at the business-rule level rather than as raw CRUD.
 */

export { prisma, type PrismaClient, disconnectPrisma } from './client.js';
export * as repositories from './repositories/index.js';
export type {
  User,
  NexusIdentity,
  StripeCustomer,
  Subscription,
  ApiSession,
  MeteredUsage,
} from '../prisma-client/index.js';
