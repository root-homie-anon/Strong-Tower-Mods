/**
 * Session lifecycle endpoints.
 *
 *   POST /session/open  -> mints a JWT, opens an ApiSession, sets up
 *                          pre-auth for Custom-tier sessions
 *   POST /session/close -> closes the ApiSession; captures or releases
 *                          the pre-auth based on metered usage
 *
 * The mock path (`AUTH_MOCK=true`) does not require these endpoints —
 * the WS handler accepts any bearer in that mode. The real path uses
 * them as the entire entry point: a client cannot talk to the WS
 * without first POSTing /session/open and receiving a JWT.
 *
 * For Phase E4, the open endpoint accepts an explicit `nexusUserId`
 * + `tier` body (mock-friendly). The full SSO redirect flow lands
 * once Nexus SSO registration is approved.
 */

import type { FastifyInstance } from 'fastify';
import { nexus, jwt as authJwt } from '@strong-tower/auth';
import { repositories } from '@strong-tower/db';
import {
  customers,
  preauth,
  getTierConfig,
  type BillingTier,
} from '@strong-tower/billing';
import { CompanionApiError } from './errors.js';

interface OpenSessionBody {
  /** Nexus user id from the SSO confirmation. */
  nexusUserId: number;
  /** Nexus username, cached on User row. */
  nexusUsername: string;
  /** Subscription tier the user is opening the session under. */
  tier: BillingTier;
  /** Custom tier only — per-session pre-auth ceiling in microdollars. */
  sessionCeilingMicrodollars?: number;
}

const openSessionSchema = {
  type: 'object',
  required: ['nexusUserId', 'nexusUsername', 'tier'],
  additionalProperties: false,
  properties: {
    nexusUserId: { type: 'integer', minimum: 1 },
    nexusUsername: { type: 'string', minLength: 1, maxLength: 128 },
    tier: { type: 'string', minLength: 1, maxLength: 64 },
    sessionCeilingMicrodollars: { type: 'integer', minimum: 0 },
  },
} as const;

interface CloseSessionBody {
  jti: string;
  /** Microdollars to capture on the pre-auth (Custom tier only). */
  actualMicrodollars?: number;
  /** Required when capturing — the original pre-auth ceiling. */
  preAuthMicrodollars?: number;
  /** Set when the session opened a pre-auth so we know what to act on. */
  paymentIntentId?: string;
}

const closeSessionSchema = {
  type: 'object',
  required: ['jti'],
  additionalProperties: false,
  properties: {
    jti: { type: 'string', minLength: 1 },
    actualMicrodollars: { type: 'integer', minimum: 0 },
    preAuthMicrodollars: { type: 'integer', minimum: 0 },
    paymentIntentId: { type: 'string', minLength: 1 },
  },
} as const;

export function registerSessions(app: FastifyInstance): void {
  app.post<{ Body: OpenSessionBody }>(
    '/session/open',
    { schema: { body: openSessionSchema } },
    async (req, reply) => {
      const body = req.body;
      const tierConfig = getTierConfig(body.tier);

      // 1. Materialise the User from the Nexus profile.
      const profile: { nexusUserId: number; nexusUsername: string } = {
        nexusUserId: body.nexusUserId,
        nexusUsername: body.nexusUsername,
      };
      const user = await repositories.users.upsertFromNexus(profile);

      // 2. Materialise the Stripe customer (idempotent).
      const { stripeCustomerId } = await customers.getOrCreate({
        userId: user.id,
        nexusUserId: body.nexusUserId,
      });

      // 3. Mint the JWT first so the ApiSession can be stored under
      //    the same jti without a follow-up update.
      const issued = await authJwt.issueSessionToken({
        userId: user.id,
        tier: body.tier,
      });

      // 4. Custom-tier pre-auth — runs before ApiSession.open so the
      //    paymentIntentId can be persisted on the session row in the
      //    same write.
      let preAuthIntentId: string | undefined;
      let preAuthAmount: number | undefined;
      if (tierConfig.requiresPreAuth) {
        // Open a placeholder ApiSession so preauth.create has an id to
        // associate with. We re-open with the real values after.
        const placeholder = await repositories.sessions.open({
          userId: user.id,
          jwtJti: `placeholder-${issued.jti}`,
          tier: body.tier,
        });
        try {
          const pa = await preauth.create({
            userId: user.id,
            stripeCustomerId,
            apiSessionId: placeholder.id,
            ...(body.sessionCeilingMicrodollars !== undefined
              ? { sessionCeilingMicrodollars: body.sessionCeilingMicrodollars }
              : {}),
          });
          preAuthIntentId = pa.paymentIntentId;
          preAuthAmount = pa.amountMicrodollars;
        } finally {
          // Always tear down the placeholder; the real session is
          // opened below with the real jti and pre-auth fields.
          await repositories.sessions.close(`placeholder-${issued.jti}`);
        }
      }

      // 5. Open the real ApiSession bound to the JWT jti.
      await repositories.sessions.open({
        userId: user.id,
        jwtJti: issued.jti,
        tier: body.tier,
        ...(preAuthIntentId !== undefined
          ? { stripePreAuthIntentId: preAuthIntentId }
          : {}),
        ...(preAuthAmount !== undefined
          ? { preAuthAmountMicrodollars: preAuthAmount }
          : {}),
      });

      return reply.send({
        token: issued.token,
        jti: issued.jti,
        expiresAt: issued.expiresAt.toISOString(),
        tier: body.tier,
        ...(preAuthIntentId
          ? { preAuth: { paymentIntentId: preAuthIntentId, amountMicrodollars: preAuthAmount } }
          : {}),
      });
    }
  );

  app.post<{ Body: CloseSessionBody }>(
    '/session/close',
    { schema: { body: closeSessionSchema } },
    async (req, reply) => {
      const body = req.body;

      const session = await repositories.sessions.findByJti(body.jti);
      if (!session) {
        throw new CompanionApiError('SESSION_NOT_FOUND', `No session for jti ${body.jti}`, 404);
      }

      // Capture or release a Custom-tier pre-auth before closing the
      // session — once closedAt is stamped, the metered total is
      // frozen and a late capture would be silently wrong.
      if (body.paymentIntentId && body.preAuthMicrodollars !== undefined) {
        const actual = body.actualMicrodollars ?? session.meteredTotalMicrodollars;
        if (actual > 0) {
          await preauth.capture({
            paymentIntentId: body.paymentIntentId,
            actualMicrodollars: actual,
            preAuthMicrodollars: body.preAuthMicrodollars,
          });
        } else {
          await preauth.release(body.paymentIntentId);
        }
      }

      const closed = await repositories.sessions.close(body.jti);

      return reply.send({
        jti: body.jti,
        closedAt: closed?.closedAt?.toISOString() ?? null,
        finalMeteredMicrodollars: closed?.meteredTotalMicrodollars ?? 0,
      });
    }
  );
}

// Re-export under a named export so server.ts's wiring intent reads cleanly.
export { registerSessions as default };
