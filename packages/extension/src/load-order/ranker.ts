/**
 * AI-curated load order ranking.
 *
 * Two modes:
 *
 *   - Mock (``RANKER_MOCK=true``): applies a deterministic heuristic
 *     that mirrors the broad strokes Claude would land on — masters
 *     first, then frameworks, then content, then patches, then tweaks
 *     within each bucket alphabetically. Used in CI and for offline
 *     dev so the extension's downstream consumption (Vortex hook
 *     integration, UI panel rendering, persistence) can run without a
 *     reachable cloud.
 *
 *   - Real (default): POSTs the mod list to ``${cloud.baseUrl}/load-order/rank``
 *     on the companion API with a bearer JWT. The cloud holds the
 *     Anthropic key and the cached system prompt for load-order best
 *     practices; the extension never touches Claude directly so user
 *     machines never hold our API key.
 *
 * In real mode ``options.cloud`` is required — the function raises a
 * clear ``NexusApiError`` if it's missing so a misconfigured caller
 * hits a surfaced error instead of a silent hang. The Phase E5 cloud
 * handler in ``packages/shared/api/companion/src/load-order.ts`` is
 * the matching endpoint on the other side of this wire.
 */

import { NexusApiError } from '../nexus-api/errors.js';

export interface CloudRankerConfig {
  /** Base URL of the cloud companion API. */
  baseUrl: string;
  /** Bearer JWT minted via /session/open. */
  token: string;
  /** Fetch impl override; defaults to ``globalThis.fetch``. */
  fetchImpl?: typeof fetch;
}

export interface RankerOptions {
  /**
   * Cloud config — required when ``RANKER_MOCK`` is unset. Mock mode
   * ignores this field, so the same call site works in both modes
   * once a fallback is in place.
   */
  cloud?: CloudRankerConfig;
}

/**
 * Summary of a single mod, in the shape Vortex hands us via
 * ``api.getState().persistent.mods``. The ranker reads only what it
 * needs from the Vortex mod shape; new fields can be added without
 * touching the call sites.
 */
export interface ModSummary {
  modId: string;
  name: string;
  /** Mod author from Nexus metadata. */
  author?: string;
  /** Nexus category name (e.g. "Bug Fixes", "Gameplay", "Patches"). */
  category?: string;
  /** Plugin filenames the mod ships, e.g. ['MyMod.esp', 'MyMod.esl']. */
  pluginFiles?: string[];
  /** Master files this mod declares as required, e.g. ['Fallout4.esm', 'DLCRobot.esm']. */
  masters?: string[];
  /**
   * High-level type classification, set by the caller when available
   * (Vortex tags it automatically for many mods). Tightens the mock
   * heuristic; real Claude inference uses it as a soft hint.
   */
  kind?: 'master' | 'framework' | 'content' | 'patch' | 'tweak' | 'unknown';
  /** Free-form notes from the mod's Nexus description that the caller has summarised. */
  notes?: string;
}

export interface RankedMod {
  modId: string;
  /** 0-based position in the recommended load order. */
  rank: number;
  /** One-to-two-sentence plain-English explanation. */
  rationale: string;
}

export interface RankingResult {
  ranked: RankedMod[];
  /**
   * Non-fatal observations the ranker noticed while ordering
   * (cycle suspects, mods without declared masters, framework
   * patches without their host framework, etc.). Surfaced to the
   * Vortex UI so the user can act on them without re-running.
   */
  warnings: string[];
  /** Mock or real path actually used to produce this ranking. */
  source: 'mock-heuristic' | 'cloud-claude';
}

export function isMockMode(): boolean {
  return process.env['RANKER_MOCK'] === 'true';
}

/**
 * Produce a ranked load order. Idempotent and pure relative to its
 * input — calling with the same mod list twice in mock mode yields
 * the same ordering and the same rationale strings.
 */
export async function rankLoadOrder(
  mods: ModSummary[],
  options?: RankerOptions
): Promise<RankingResult> {
  if (mods.length === 0) {
    return { ranked: [], warnings: [], source: isMockMode() ? 'mock-heuristic' : 'cloud-claude' };
  }

  if (isMockMode()) {
    return mockHeuristicRank(mods);
  }

  // Real cloud path. POST the mod list to /load-order/rank and trust
  // the response. The cloud has the Anthropic key + the cache-friendly
  // system prompt; the extension never touches Claude directly.
  if (!options?.cloud) {
    throw new NexusApiError(
      'LOAD_ORDER_CLOUD_CONFIG_MISSING',
      'Real-mode rankLoadOrder requires options.cloud (baseUrl + token). ' +
        'Set RANKER_MOCK=true for offline development.',
      400
    );
  }

  return cloudRank(mods, options.cloud);
}

// ---------------------------------------------------------------------------
// Mock heuristic
// ---------------------------------------------------------------------------

const KIND_ORDER: Record<NonNullable<ModSummary['kind']>, number> = {
  master: 0,
  framework: 1,
  content: 2,
  patch: 3,
  tweak: 4,
  unknown: 5,
};

function inferKind(mod: ModSummary): NonNullable<ModSummary['kind']> {
  if (mod.kind) return mod.kind;
  // Heuristic fallbacks when kind is not pre-tagged. Conservative —
  // anything we can't classify lands in 'unknown' and the warning
  // list calls it out so the user can correct upstream metadata.
  if (mod.pluginFiles?.some((f) => f.toLowerCase().endsWith('.esm'))) return 'master';
  if (mod.category) {
    const c = mod.category.toLowerCase();
    if (c.includes('patch')) return 'patch';
    if (c.includes('framework') || c.includes('library') || c.includes('utility')) {
      return 'framework';
    }
    if (c.includes('tweak') || c.includes('balance')) return 'tweak';
    if (c.includes('quest') || c.includes('weapon') || c.includes('armor') || c.includes('settlement')) {
      return 'content';
    }
  }
  return 'unknown';
}

function mockHeuristicRank(mods: ModSummary[]): RankingResult {
  const annotated = mods.map((mod) => ({ mod, kind: inferKind(mod) }));
  const warnings: string[] = [];

  for (const { mod, kind } of annotated) {
    if (kind === 'unknown') {
      warnings.push(
        `Could not classify mod ${mod.name} (${mod.modId}) — missing kind tag and no recognisable category. Mock heuristic placed it last.`
      );
    }
    if (!mod.masters && kind !== 'master') {
      warnings.push(
        `Mod ${mod.name} (${mod.modId}) declares no masters — load order may be unstable if it patches an unlisted file.`
      );
    }
  }

  const sorted = [...annotated].sort((a, b) => {
    const ka = KIND_ORDER[a.kind];
    const kb = KIND_ORDER[b.kind];
    if (ka !== kb) return ka - kb;
    return a.mod.name.localeCompare(b.mod.name);
  });

  const ranked = sorted.map(({ mod, kind }, rank) => ({
    modId: mod.modId,
    rank,
    rationale: rationaleFor(kind, mod),
  }));

  return { ranked, warnings, source: 'mock-heuristic' };
}

async function cloudRank(
  mods: ReadonlyArray<ModSummary>,
  cloud: CloudRankerConfig
): Promise<RankingResult> {
  const fetcher = cloud.fetchImpl ?? globalThis.fetch;
  const url = joinUrl(cloud.baseUrl, '/load-order/rank');

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cloud.token}`,
      },
      body: JSON.stringify({ mods }),
    });
  } catch (err) {
    throw new NexusApiError(
      'LOAD_ORDER_CLOUD_UNREACHABLE',
      `POST ${url} failed before a response: ${(err as Error).message}`,
      503
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '<no body>');
    throw new NexusApiError(
      'LOAD_ORDER_CLOUD_REJECTED',
      `Cloud /load-order/rank returned ${response.status}: ${text}`,
      response.status
    );
  }

  const raw = (await response.json()) as {
    ranked?: Array<{ modId: string; rank: number; rationale: string }>;
    warnings?: string[];
    source?: string;
  };

  return {
    ranked: Array.isArray(raw.ranked) ? raw.ranked : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    // The cloud distinguishes 'cloud-claude' (real Claude) from
    // 'cloud-mock' (ANTHROPIC_MOCK=true on the cloud side). Both
    // are "the cloud answered", so we normalise to 'cloud-claude'
    // here — downstream consumers care about source provenance
    // (cloud vs local), not which mock branch the cloud took.
    source: 'cloud-claude',
  };
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function rationaleFor(kind: NonNullable<ModSummary['kind']>, mod: ModSummary): string {
  switch (kind) {
    case 'master':
      return `Master file (.esm) — must load before any plugin that declares it as a master. ${mod.name} sits at the top of the order with the other masters.`;
    case 'framework':
      return `Framework / library mod — patches and content that depend on its records must load after. Placed before content so its records are available downstream.`;
    case 'content':
      return `Content mod — adds new records (quests, items, locations). Loaded after frameworks so its references resolve cleanly, before patches so they can override its records.`;
    case 'patch':
      return `Patch — overrides records from one or more content mods. Loaded after the content it patches; if the patch host is missing, the override is a no-op.`;
    case 'tweak':
      return `Tweak / balance mod — final-word small overrides on values like damage, prices, NPC stats. Loaded near the bottom so it has the last say.`;
    case 'unknown':
    default:
      return `Unclassified mod — no kind tag and no recognisable category. Placed at the bottom; review and tag for a stable ordering in future runs.`;
  }
}
