/**
 * Metadata-driven conflict detection.
 *
 * Three classes of finding ship today:
 *
 *   1. **missing-master** — Mod A declares a master that no mod in the
 *      load order provides. Game will fail to load the plugin.
 *      Severity: blocker.
 *
 *   2. **duplicate-plugin** — Two mods ship a plugin file with the same
 *      filename. The second-loaded one wins silently; the first is
 *      wasted disk. Severity: error.
 *
 *   3. **out-of-order-master** — Mod A declares Master M, both are in
 *      the load order, but Mod A is positioned *before* Master M.
 *      Game-loader behaviour for this case is undefined (sometimes
 *      crashes, sometimes silently re-orders). Severity: error.
 *
 *   4. **plugin-without-master** — Mod A's plugin filename ends with
 *      .esp or .esl but the mod summary declares no masters. Common
 *      with badly-packaged patches; the plugin will load but its
 *      references won't resolve. Severity: warning.
 *
 * All four are purely metadata-driven — no ESP parsing — so the
 * detector runs in O(n) over the mod list and is safe to invoke on
 * every load-order change without noticeable cost.
 */

import type { ModSummary } from '../load-order/ranker.js';
import type { ConflictFinding, ConflictReport } from './types.js';

/**
 * Run the conflict detector over a (possibly already-ranked) mod
 * list. ``rankedOrder`` is the array of ``modId`` strings in the
 * load order Vortex will apply; if it is omitted, out-of-order
 * findings are skipped (the detector cannot reason about ordering
 * without it).
 */
export function detectConflicts(
  mods: ModSummary[],
  rankedOrder?: string[]
): ConflictReport {
  const findings: ConflictFinding[] = [];
  const notes: string[] = [];

  // Build lookup indexes once so each downstream pass is O(n).
  const modById = new Map<string, ModSummary>();
  for (const mod of mods) {
    modById.set(mod.modId, mod);
  }
  // pluginFilename (case-normalised) -> mod ids that ship it
  const pluginsByName = new Map<string, string[]>();
  // mod id -> set of plugin filenames it ships
  const pluginsByMod = new Map<string, Set<string>>();
  // master filename -> mod ids that ship a plugin with that name
  // (we identify "the mod that provides master Foo.esm" as "the mod
  // whose pluginFiles contains Foo.esm", since the master-file format
  // is the same as a plugin file).
  const providersOf = new Map<string, string[]>();

  for (const mod of mods) {
    const plugins = new Set<string>();
    for (const filename of mod.pluginFiles ?? []) {
      const lower = filename.toLowerCase();
      plugins.add(lower);
      const ownersByName = pluginsByName.get(lower) ?? [];
      ownersByName.push(mod.modId);
      pluginsByName.set(lower, ownersByName);
      const providers = providersOf.get(lower) ?? [];
      providers.push(mod.modId);
      providersOf.set(lower, providers);
    }
    pluginsByMod.set(mod.modId, plugins);
  }

  // ---- 1. Missing master ----
  for (const mod of mods) {
    for (const master of mod.masters ?? []) {
      const lower = master.toLowerCase();
      const providers = providersOf.get(lower) ?? [];
      // A master is "provided" either by another mod in the load
      // order or by the game itself. The detector does not have
      // visibility into the game's vanilla masters (Fallout4.esm,
      // DLCRobot.esm, ...) so we have to gate on a known-vanilla
      // list — anything else missing surfaces as a blocker.
      if (providers.length === 0 && !VANILLA_MASTERS.has(lower)) {
        findings.push({
          kind: 'missing-master',
          severity: 'blocker',
          modIds: [mod.modId],
          resource: master,
          shortDescription: `missing-master:${master}`,
        });
      }
    }
  }

  // ---- 2. Duplicate plugin filenames ----
  for (const [filename, owners] of pluginsByName) {
    if (owners.length > 1) {
      findings.push({
        kind: 'duplicate-plugin',
        severity: 'error',
        modIds: [...owners],
        resource: filename,
        shortDescription: `duplicate-plugin:${filename}`,
      });
    }
  }

  // ---- 3. Out-of-order master ----
  if (rankedOrder) {
    const positionByMod = new Map<string, number>();
    rankedOrder.forEach((modId, idx) => positionByMod.set(modId, idx));

    for (const mod of mods) {
      const myPos = positionByMod.get(mod.modId);
      if (myPos === undefined) continue;
      for (const master of mod.masters ?? []) {
        const lower = master.toLowerCase();
        // Vanilla masters are assumed loaded by the game before any
        // mod regardless of rank, so we skip the position check.
        if (VANILLA_MASTERS.has(lower)) continue;
        const providers = providersOf.get(lower) ?? [];
        for (const providerId of providers) {
          const providerPos = positionByMod.get(providerId);
          if (providerPos === undefined) continue;
          if (providerPos >= myPos) {
            findings.push({
              kind: 'out-of-order-master',
              severity: 'error',
              modIds: [mod.modId, providerId],
              resource: master,
              shortDescription: `out-of-order-master:${mod.modId}<${providerId}`,
            });
          }
        }
      }
    }
  } else {
    notes.push('Skipped out-of-order-master pass: no rankedOrder provided.');
  }

  // ---- 4. Plugin without master ----
  for (const mod of mods) {
    const hasMasters = (mod.masters ?? []).length > 0;
    if (hasMasters) continue;
    const hasPlugin = (mod.pluginFiles ?? []).some(
      (f) => f.toLowerCase().endsWith('.esp') || f.toLowerCase().endsWith('.esl')
    );
    if (hasPlugin && mod.kind !== 'master') {
      findings.push({
        kind: 'plugin-without-master',
        severity: 'warning',
        modIds: [mod.modId],
        resource: (mod.pluginFiles ?? [])[0] ?? '',
        shortDescription: `plugin-without-master:${mod.modId}`,
      });
    }
  }

  return { findings, notes };
}

/**
 * Vanilla Fallout 4 master filenames the game ships. Lowercased.
 * The detector treats these as always-provided so a mod that
 * declares them as masters does not produce a missing-master finding.
 */
const VANILLA_MASTERS: ReadonlySet<string> = new Set([
  'fallout4.esm',
  'dlcrobot.esm',
  'dlcworkshop01.esm',
  'dlccoast.esm',
  'dlcworkshop02.esm',
  'dlcworkshop03.esm',
  'dlcnukaworld.esm',
  'dlcultrahighresolution.esm',
]);
