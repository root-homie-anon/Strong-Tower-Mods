/**
 * Plain-English conflict explanations.
 *
 * Two modes, same shape as the load-order ranker:
 *
 *   - Mock (``EXPLAINER_MOCK=true`` OR the default until the real
 *     cloud path lands): templated strings keyed off the finding's
 *     kind + the mod metadata. Deterministic and free.
 *   - Real (future): hands the finding plus the mod descriptions
 *     to Claude on the cloud /conflict/explain endpoint for richer
 *     phrasing. Same pattern as load-order ranking — the cloud
 *     holds the API key and the cache-friendly system prompt.
 *
 * Even in real mode the suggested-action string stays templated so
 * Vortex can wire its buttons up at compile time without parsing
 * Claude prose.
 */

import type { ModSummary } from '../load-order/ranker.js';
import type { ConflictFinding, ConflictExplanation } from './types.js';

export interface CloudExplainerConfig {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface ExplainerOptions {
  /** Cloud config — required to take the real path. Mock mode ignores. */
  cloud?: CloudExplainerConfig;
}

export function isMockMode(): boolean {
  // Default true so existing callers continue to get the local
  // template path. Pass options.cloud and set EXPLAINER_MOCK=false to
  // hit the real /conflict/explain endpoint.
  if (process.env['EXPLAINER_MOCK'] === 'false') return false;
  return true;
}

/**
 * Synchronous + asynchronous overloads — mock-mode callers do not
 * need to await, real-mode callers do. We always return a Promise
 * so the runtime shape is consistent; mock-mode resolves
 * synchronously via ``Promise.resolve`` so a caller that ``await``s
 * pays nothing extra.
 */
export async function explainConflict(
  finding: ConflictFinding,
  mods: ReadonlyArray<ModSummary>,
  options?: ExplainerOptions
): Promise<ConflictExplanation> {
  if (isMockMode() || !options?.cloud) {
    return mockExplain(finding, mods);
  }
  return cloudExplain(finding, mods, options.cloud);
}

function mockExplain(
  finding: ConflictFinding,
  mods: ReadonlyArray<ModSummary>
): ConflictExplanation {
  const modById = new Map<string, ModSummary>();
  for (const mod of mods) modById.set(mod.modId, mod);
  const subject = modById.get(finding.modIds[0] ?? '');
  const partner = finding.modIds[1] ? modById.get(finding.modIds[1]) : undefined;
  return {
    finding,
    text: mockText(finding, subject, partner),
    suggestedAction: mockSuggestedAction(finding),
    source: 'mock-template',
  };
}

async function cloudExplain(
  finding: ConflictFinding,
  mods: ReadonlyArray<ModSummary>,
  cloud: CloudExplainerConfig
): Promise<ConflictExplanation> {
  const fetcher = cloud.fetchImpl ?? globalThis.fetch;
  const url = joinUrl(cloud.baseUrl, '/conflict/explain');
  const response = await fetcher(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cloud.token}`,
    },
    body: JSON.stringify({ finding, mods }),
  });
  if (!response.ok) {
    // Fall back to the template rather than throwing — the user
    // clicked "Explain" on a notification; surfacing an error here
    // would be worse UX than degraded prose.
    return mockExplain(finding, mods);
  }
  const raw = (await response.json()) as { text?: string; suggestedAction?: string };
  return {
    finding,
    text: typeof raw.text === 'string' ? raw.text : '',
    suggestedAction: typeof raw.suggestedAction === 'string' ? raw.suggestedAction : '',
    source: 'cloud-claude',
  };
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function mockText(
  finding: ConflictFinding,
  subject: ModSummary | undefined,
  partner: ModSummary | undefined
): string {
  const subjectName = subject?.name ?? finding.modIds[0] ?? 'unknown mod';
  const partnerName = partner?.name ?? finding.modIds[1] ?? 'unknown partner';

  switch (finding.kind) {
    case 'missing-master':
      return (
        `${subjectName} declares ${finding.resource} as a required master, but no mod in your load order ` +
        `provides that file and it is not part of the vanilla game. The plugin will refuse to load and any ` +
        `references it makes into ${finding.resource} will resolve to nothing.`
      );
    case 'duplicate-plugin':
      return (
        `${finding.modIds.length} mods ship a plugin named ${finding.resource}. ` +
        `Whichever Vortex deploys last will silently overwrite the others, and the disk space they consume ` +
        `is wasted. Mods involved: ${finding.modIds.join(', ')}.`
      );
    case 'out-of-order-master':
      return (
        `${subjectName} declares ${partnerName} (${finding.resource}) as a master, but in the current order ` +
        `${subjectName} loads before ${partnerName}. Bethesda's loader does not guarantee what happens in this ` +
        `case — most often it crashes on launch, sometimes it silently re-orders and forgets your manual edits.`
      );
    case 'plugin-without-master':
      return (
        `${subjectName} ships a plugin (${finding.resource}) but declares no masters. ` +
        `If the plugin patches records from another mod, those references will not resolve and the patch ` +
        `will appear to do nothing in-game. Usually this means the mod author forgot to repack the plugin ` +
        `after editing.`
      );
    case 'master-mismatch':
      return (
        `${subjectName}'s declared masters disagree with what its plugin file actually requires. ` +
        `Differences: ${finding.resource}. Either the Vortex metadata is stale or the plugin was modified ` +
        `outside Vortex; either way the load order Vortex computes from metadata may not match what the ` +
        `game actually needs.`
      );
    case 'record-type-overlap':
      return (
        `${finding.modIds.length} mods all contain ${finding.resource} records: ${finding.modIds.join(', ')}. ` +
        `That doesn't mean they actually conflict, but whichever loads last will override the others' edits ` +
        `to that record type. Pay attention to load-order placement.`
      );
    default: {
      // Exhaustiveness check — adding a new ConflictKind without
      // updating mockText causes a TypeScript error here.
      const _exhaustive: never = finding.kind;
      return `Unrecognised conflict kind: ${String(_exhaustive)}`;
    }
  }
}

function mockSuggestedAction(finding: ConflictFinding): string {
  switch (finding.kind) {
    case 'missing-master':
      return `Install the mod that provides ${finding.resource}, or disable the plugin that depends on it.`;
    case 'duplicate-plugin':
      return `Pick one of the conflicting mods and disable the others, or contact the authors about renaming.`;
    case 'out-of-order-master':
      return `Re-run "Sort load order" from the Vortex toolbar, or move the dependent mod manually to after its master.`;
    case 'plugin-without-master':
      return `Open the mod's page on Nexus and check if a repack is available. If not, the plugin may simply be inert.`;
    case 'master-mismatch':
      return `Reinstall the mod through Vortex (so metadata refreshes), or open the plugin in xEdit to verify the actual master list.`;
    case 'record-type-overlap':
      return `Check whether one of the mods is intended to be a patch for the other; if so, place the patch later in the load order.`;
    default: {
      const _exhaustive: never = finding.kind;
      return `No suggested action: ${String(_exhaustive)}`;
    }
  }
}
