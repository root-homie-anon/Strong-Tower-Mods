/**
 * Public entry point for @strong-tower/auth.
 *
 * Auth in Strong Tower Mods is a 3-step flow:
 *
 *   1. Client opens Nexus SSO.        ─ `nexus.startSsoFlow()`
 *   2. User confirms on Nexus.         ─ `nexus.awaitConfirmation()`
 *   3. We mint a JWT bound to the      ─ `jwt.issueSessionToken()`
 *      User row our DB just upserted.
 *
 * The Fastify hook `requireAuth` consumes the resulting JWT on every
 * request that talks to the companion API.
 */

export * as nexus from './nexus.js';
export * as jwt from './jwt.js';
export { requireAuth, type AuthenticatedRequest } from './middleware.js';
export type { SessionClaims, IssueTokenInput } from './jwt.js';
export type { NexusSsoResult, NexusSsoFlow } from './nexus.js';
