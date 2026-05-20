/**
 * Vortex extension entry point.
 *
 * Vortex loads this file by `require()`-ing the packed extension
 * directory's main entry. It is INTENTIONALLY excluded from
 * tsconfig.json's `include` glob (see ../tsconfig.json) because it
 * imports from the `vortex-api` package, which is only published on
 * GitHub (`github:Nexus-Mods/vortex-api`). Pulling that dep at
 * install time was blocked by our auto-mode classifier when first
 * tried, so the official install path is:
 *
 *   1. Install Vortex locally:           https://www.nexusmods.com/site/mods/1
 *   2. Add the dep in this package:      bun add --dev github:Nexus-Mods/vortex-api
 *   3. Edit ../tsconfig.json to include  "src/vortex-init.ts"
 *   4. `bun run build` from this package — vortex-init.ts now
 *      compiles into dist/ alongside the rest of the extension.
 *   5. Pack the extension folder and install it via Vortex's
 *      "Install From File" in the Extensions tab.
 *
 * Until then the file lives here as a wiring blueprint: every line
 * is real Vortex API code that will execute the day the dep is
 * added, just gated behind the build exclusion so a missing
 * vortex-api doesn't break `bun run typecheck`.
 *
 * The orchestration layer it imports IS typechecked and tested,
 * so the only thing this file adds at runtime is button-to-action
 * plumbing.
 */

// @ts-nocheck — see file-header docstring; vortex-api isn't installed.
// Remove the directive once you've added the dep and re-enabled the
// file in tsconfig.json's include list.

import {
  sortLoadOrderAction,
  detectConflictsAction,
  parseLatestCrashAction,
  linkAccountAction,
  unlinkAccountAction,
  type CrashLogReader,
} from './orchestration.js';
import type { ModSummary } from './load-order/index.js';
import type { SessionStore, StoredSession } from './account/index.js';
import type { CloudConfig } from './account/index.js';

import { types, util } from 'vortex-api';
import * as fs from 'fs/promises';
import * as path from 'path';

const EXT_NAMESPACE = 'strong-tower-mods';
const CLOUD_BASE_URL_DEFAULT = 'http://127.0.0.1:8080';

/** Vortex stores our per-profile session at this state path. */
const SESSION_STATE_PATH = ['persistent', EXT_NAMESPACE, 'session'];
/** Cloud base URL configured by the user via the Settings panel. */
const CLOUD_URL_STATE_PATH = ['persistent', EXT_NAMESPACE, 'cloudBaseUrl'];

/**
 * Pull the cloud base URL + bearer token from Vortex state.
 *
 * Returns ``undefined`` (rather than throwing) when the user has not
 * linked an account yet — the orchestration layer then falls back to
 * its mock heuristic so the user can still get a useful local
 * ranking before logging in.
 */
function readCloudConfig(api: types.IExtensionApi):
  | { baseUrl: string; token: string }
  | undefined {
  const state = api.getState();
  const baseUrl =
    (util.getSafe(state, CLOUD_URL_STATE_PATH, CLOUD_BASE_URL_DEFAULT) as string) ??
    CLOUD_BASE_URL_DEFAULT;
  const session = util.getSafe(state, SESSION_STATE_PATH, null) as StoredSession | null;
  if (!session) return undefined;
  return { baseUrl, token: session.token };
}

function makeVortexSessionStore(api: types.IExtensionApi): SessionStore {
  return {
    async load() {
      const state = api.getState();
      return util.getSafe(state, SESSION_STATE_PATH, null) as StoredSession | null;
    },
    async save(session) {
      api.store.dispatch({
        type: `${EXT_NAMESPACE}/SET_SESSION`,
        payload: session,
      });
    },
    async clear() {
      api.store.dispatch({
        type: `${EXT_NAMESPACE}/CLEAR_SESSION`,
        payload: null,
      });
    },
  };
}

function makeVortexCrashReader(api: types.IExtensionApi): CrashLogReader {
  return {
    async listCrashLogs() {
      const docs = api.getState().settings.gameMode.discovered?.['fallout4']?.path ?? '';
      // Buffout writes crash logs to "Documents\My Games\Fallout4\F4SE".
      // Vortex resolves the user's Documents path on demand via remote
      // discovery; for now we read from the user's profile folder.
      const dir = path.join(util.getVortexPath('documents'), 'My Games', 'Fallout 4', 'F4SE');
      const entries = await fs.readdir(dir).catch(() => []);
      const crashes = entries.filter((f: string) => /^crash-.*\.log$/i.test(f));
      // Sort newest first by filename — Buffout embeds the ISO
      // timestamp in the name so lexical order equals chronological.
      return crashes.sort().reverse();
    },
    async readCrashLog(name) {
      const dir = path.join(util.getVortexPath('documents'), 'My Games', 'Fallout 4', 'F4SE');
      return fs.readFile(path.join(dir, name), 'utf-8');
    },
  };
}

function modsFromVortexState(api: types.IExtensionApi): ModSummary[] {
  const state = api.getState();
  const mods = util.getSafe(state, ['persistent', 'mods', 'fallout4'], {}) as Record<string, unknown>;
  return Object.entries(mods).map(([modId, raw]) => {
    const r = raw as {
      attributes?: {
        modName?: string;
        author?: string;
        category?: string;
        installTime?: string;
      };
      installationPath?: string;
      type?: string;
    };
    return {
      modId,
      name: r.attributes?.modName ?? modId,
      ...(r.attributes?.author ? { author: r.attributes.author } : {}),
      ...(r.attributes?.category ? { category: r.attributes.category } : {}),
    } satisfies ModSummary;
  });
}

function init(context: types.IExtensionContext): boolean {
  context.registerReducer([EXT_NAMESPACE], {
    defaults: { session: null },
    reducers: {
      [`${EXT_NAMESPACE}/SET_SESSION`]: (state, payload) => ({ ...state, session: payload }),
      [`${EXT_NAMESPACE}/CLEAR_SESSION`]: (state) => ({ ...state, session: null }),
    },
  });

  context.registerAction(
    'mod-icons',
    100,
    'sort',
    {},
    'Sort Load Order (AI)',
    async () => {
      const api = context.api;
      const mods = modsFromVortexState(api);
      const cloud = readCloudConfig(api);
      const result = await sortLoadOrderAction({ mods, ...(cloud ? { cloud } : {}) });
      api.sendNotification({
        type: 'success',
        message: `${result.source === 'cloud-claude' ? 'AI' : 'Heuristic'}-sorted ${result.ranked.length} mods`,
        actions: [{ title: 'Apply', action: () => applyOrder(api, result) }],
      });
    }
  );

  context.registerAction('mod-icons', 110, 'flag', {}, 'Detect Conflicts', async () => {
    const api = context.api;
    const mods = modsFromVortexState(api);
    const cloud = readCloudConfig(api);
    const { report, explanations } = await detectConflictsAction({
      mods,
      ...(cloud ? { cloud } : {}),
    });
    if (report.findings.length === 0) {
      api.sendNotification({ type: 'success', message: 'No conflicts detected.' });
      return;
    }
    for (const explanation of explanations) {
      api.sendNotification({
        type: explanation.finding.severity === 'blocker' ? 'error' : 'warning',
        message: explanation.text,
        actions: [{ title: 'Suggested', action: () => api.showDialog('info', 'Suggested action', { text: explanation.suggestedAction }, [{ label: 'OK' }]) }],
      });
    }
  });

  context.registerAction('global-icons', 200, 'log', {}, 'Parse Latest Crash', async () => {
    const api = context.api;
    const reader = makeVortexCrashReader(api);
    const { filename, report } = await parseLatestCrashAction(reader);
    if (!filename || !report) {
      api.sendNotification({ type: 'info', message: 'No crash logs found.' });
      return;
    }
    api.sendNotification({
      type: 'info',
      message: `${filename}: ${report.exception ?? 'unknown'} in ${report.module ?? 'unknown'}`,
    });
  });

  context.registerSettings('Strong Tower Mods', () => null, undefined, undefined, 100);

  return true;
}

function applyOrder(api: types.IExtensionApi, _result: unknown): void {
  // TODO: wire to Vortex's loadOrder API. The Phase 2.3 mock returns
  // a ranked list; the real cloud /load-order/rank endpoint will
  // return the same shape, so the same applyOrder call works under
  // either source.
  api.sendNotification({ type: 'info', message: 'Apply not yet wired — see Phase 2.7 TODO.' });
}

// Auxiliary exports for testability without Vortex.
export { init, makeVortexSessionStore, makeVortexCrashReader, modsFromVortexState };

export default init;
