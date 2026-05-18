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

export function isMockMode(): boolean {
  // Currently the default; the real path lands together with the
  // /conflict/explain cloud endpoint. Until then this returns true
  // unconditionally — there is no real path to flip to.
  if (process.env['EXPLAINER_MOCK'] === 'false') return false;
  return true;
}

export function explainConflict(
  finding: ConflictFinding,
  mods: ReadonlyArray<ModSummary>
): ConflictExplanation {
  // ``mods`` is the same list passed to detectConflicts so explainer
  // and detector see identical state. We look up each involved mod
  // here rather than asking the caller to pre-join.
  const modById = new Map<string, ModSummary>();
  for (const mod of mods) modById.set(mod.modId, mod);
  const subject = modById.get(finding.modIds[0] ?? '');
  const partner = finding.modIds[1] ? modById.get(finding.modIds[1]) : undefined;

  const text = mockText(finding, subject, partner);
  const suggestedAction = mockSuggestedAction(finding);

  return {
    finding,
    text,
    suggestedAction,
    source: isMockMode() ? 'mock-template' : 'cloud-claude',
  };
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
    default: {
      const _exhaustive: never = finding.kind;
      return `No suggested action: ${String(_exhaustive)}`;
    }
  }
}
