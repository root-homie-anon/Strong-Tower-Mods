/**
 * Shared metered-usage recording.
 *
 * Both /companion/turn and the new /load-order/rank,
 * /conflict/explain endpoints write a MeteredUsage row per
 * successful Claude call. Factoring the write out here keeps the
 * billing pipeline consistent across feature surfaces and means a
 * future change (cost computation, retry policy, async batching)
 * only has to land in one place.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyBaseLogger } from 'fastify';
import { repositories } from '@strong-tower/db';
import type { AuthContext } from './auth.js';

// ---------------------------------------------------------------------------
// Pricing constants — claude-sonnet-4-6, microdollars per token.
// Duplicated here from turn.ts intentionally so the two call sites stay
// independently grep-able; both are kept in sync against the official
// Anthropic pricing page.
// ---------------------------------------------------------------------------

const USD_PER_INPUT_TOKEN = 3.0 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;
const USD_PER_CACHE_READ_TOKEN = 0.3 / 1_000_000;
const USD_PER_CACHE_WRITE_TOKEN = 3.75 / 1_000_000;
const MICRODOLLARS_PER_USD = 1_000_000;

export function computeBillingMetric(usage: Anthropic.Usage): number {
  const inputCost = (usage.input_tokens ?? 0) * USD_PER_INPUT_TOKEN;
  const outputCost = (usage.output_tokens ?? 0) * USD_PER_OUTPUT_TOKEN;
  const cacheReadCost = (usage.cache_read_input_tokens ?? 0) * USD_PER_CACHE_READ_TOKEN;
  const cacheWriteCost = (usage.cache_creation_input_tokens ?? 0) * USD_PER_CACHE_WRITE_TOKEN;
  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return Math.round(total * MICRODOLLARS_PER_USD);
}

export interface RecordTurnUsageInput {
  log: FastifyBaseLogger;
  authCtx: AuthContext;
  usage: Anthropic.Usage;
  /** Discriminator for the MeteredUsage row, e.g. 'claude_turn', 'load_order_rank'. */
  metric: string;
}

/**
 * Look up the ApiSession + write a MeteredUsage row. Failures are
 * logged and swallowed — billing recording must never break the
 * synchronous response path the user is waiting on. The
 * denormalized total on ApiSession will simply reflect what was
 * successfully written.
 */
export async function recordTurnUsage(input: RecordTurnUsageInput): Promise<void> {
  if (input.authCtx.mock) return;

  const cost = computeBillingMetric(input.usage);

  try {
    const session = await repositories.sessions.findByJti(input.authCtx.jti);
    if (!session) {
      input.log.warn(
        { jti: input.authCtx.jti },
        'Skipping MeteredUsage write — ApiSession no longer exists'
      );
      return;
    }
    await repositories.usage.record({
      apiSessionId: session.id,
      userId: input.authCtx.userId,
      metric: input.metric,
      quantity: 1,
      costMicrodollars: cost,
    });
  } catch (err) {
    input.log.error(
      { err, jti: input.authCtx.jti, metric: input.metric },
      'Failed to record MeteredUsage row'
    );
  }
}
