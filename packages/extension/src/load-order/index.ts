/**
 * Public surface of the load-order subpackage.
 *
 * The ranker is the AI-curated load order intelligence that
 * differentiates our Vortex extension from upstream Vortex's hand-
 * authored LOOT-style rules. Given a flat list of mod summaries the
 * user has installed, the ranker produces a strict order and a
 * per-mod plain-English rationale that explains why this mod sits
 * where it does (master file, framework, content, patch, tweak).
 */

export { rankLoadOrder, isMockMode } from './ranker.js';
export type {
  ModSummary,
  RankedMod,
  RankingResult,
  RankerOptions,
  CloudRankerConfig,
} from './ranker.js';
