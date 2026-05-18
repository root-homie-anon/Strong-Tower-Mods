/**
 * Nexus Mods API client.
 *
 * Two modes:
 *
 *   - Real (default): wraps @nexusmods/nexus-api. The personal API
 *     key comes from process.env.NEXUS_API_KEY for dev; production
 *     will eventually use the user's SSO-issued key after
 *     authentication.
 *   - Mock (NEXUS_MOCK=true): returns deterministic fixture data
 *     and never touches the network. Tests use this path; the mock
 *     surface is intentionally narrow — only the calls our extension
 *     actually makes are mocked, so unexpected network access is
 *     impossible by construction.
 *
 * The cached singleton is invalidated whenever NEXUS_MOCK flips so
 * tests can toggle modes after import without a stale client. Same
 * pattern as @strong-tower/billing's getStripeClient().
 */

import { NexusAuthError, NexusApiError, NexusUnreachableError, NexusNotFoundError } from './errors.js';
import type {
  NexusModInfo,
  NexusModFile,
  NexusDownloadLink,
  NexusUserValidation,
  NexusGameDomain,
  ModPermissions,
} from './types.js';

/** Subset of methods our extension uses; both mock + real implement this. */
export interface NexusClient {
  validate(): Promise<NexusUserValidation>;
  getModInfo(gameDomain: NexusGameDomain, modId: number): Promise<NexusModInfo>;
  getModFiles(gameDomain: NexusGameDomain, modId: number): Promise<NexusModFile[]>;
  /** Premium users only; free users must use the Vortex SSO download flow. */
  getDownloadLink(gameDomain: NexusGameDomain, modId: number, fileId: number): Promise<NexusDownloadLink[]>;
}

export function isMockMode(): boolean {
  return process.env['NEXUS_MOCK'] === 'true';
}

let _client: NexusClient | null = null;
let _clientMode: 'mock' | 'real' | null = null;

export function getClient(): NexusClient {
  const currentMode: 'mock' | 'real' = isMockMode() ? 'mock' : 'real';
  if (_client && _clientMode === currentMode) return _client;

  _client = currentMode === 'mock' ? new MockNexusClient() : new RealNexusClient();
  _clientMode = currentMode;
  return _client;
}

export function _resetForTests(): void {
  _client = null;
  _clientMode = null;
}

// ---------------------------------------------------------------------------
// Mock client — deterministic fixtures
// ---------------------------------------------------------------------------

const PERMISSIVE_PERMISSIONS: ModPermissions = Object.freeze({
  allowOtherHosting: true,
  allowDerivatives: true,
  allowModpacks: true,
  allowTranslations: true,
  allowChanges: true,
});

const LOCKED_PERMISSIONS: ModPermissions = Object.freeze({
  allowOtherHosting: false,
  allowDerivatives: false,
  allowModpacks: false,
  allowTranslations: false,
  allowChanges: false,
});

class MockNexusClient implements NexusClient {
  async validate(): Promise<NexusUserValidation> {
    return {
      userId: 9_900_001,
      username: 'mock-tester',
      email: 'mock@example.invalid',
      isPremium: true,
      isSupporter: false,
      profileUrl: null,
      remainingDailyRequests: 599,
      totalDailyRequests: 600,
    };
  }

  async getModInfo(gameDomain: NexusGameDomain, modId: number): Promise<NexusModInfo> {
    // Some mod IDs map to opinionated fixtures so tests can assert on
    // expected behavior (locked permissions, high endorsement count,
    // etc.); the rest fall through to a generic fixture.
    const lockedMods = new Set([200, 201]);
    return {
      modId,
      gameDomain,
      name: `Mock Mod ${modId}`,
      summary: 'A fixture mod for tests.',
      description: 'Long description omitted in fixture.',
      category: 2,
      version: '1.0.0',
      author: 'mock-author',
      uploadedBy: 'mock-author',
      uploadedUserId: 9_900_002,
      endorsementCount: modId * 10,
      uniqueDownloads: modId * 1_000,
      totalDownloads: modId * 1_500,
      createdTime: '2024-01-01T00:00:00Z',
      updatedTime: '2024-06-01T00:00:00Z',
      status: 'published',
      available: true,
      permissions: lockedMods.has(modId) ? LOCKED_PERMISSIONS : PERMISSIVE_PERMISSIONS,
      pictureUrl: null,
    };
  }

  async getModFiles(gameDomain: NexusGameDomain, modId: number): Promise<NexusModFile[]> {
    return [
      {
        fileId: modId * 1000 + 1,
        modId,
        gameDomain,
        name: 'Main File',
        version: '1.0.0',
        category: 'main',
        isPrimary: true,
        fileName: `mock-mod-${modId}-1.0.0.7z`,
        fileSizeBytes: 1_234_567,
        uploadedTime: '2024-06-01T00:00:00Z',
        changelogHtml: null,
        description: '',
      },
    ];
  }

  async getDownloadLink(
    gameDomain: NexusGameDomain,
    modId: number,
    fileId: number
  ): Promise<NexusDownloadLink[]> {
    return [
      {
        uri: `https://mock-cdn.example.invalid/${gameDomain}/${modId}/${fileId}`,
        shortName: 'Mock CDN',
        shortHost: 'mock-cdn',
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Real client — wraps @nexusmods/nexus-api
// ---------------------------------------------------------------------------

/**
 * Lazily imports the upstream package so a test environment without
 * @nexusmods/nexus-api installed (or with it unmocked) can still load
 * the rest of the extension code. The import is cached on first use.
 *
 * The cache is typed as ``unknown`` because the upstream module has
 * historically shipped the Nexus class under different export names
 * (default in 1.0.x, named ``Nexus`` in 1.1+); we duck-type the
 * lookup at ``getNexus()`` time rather than committing to one shape
 * here.
 */
let _upstream: unknown = null;

async function getUpstream(): Promise<Record<string, unknown>> {
  if (_upstream) return _upstream as Record<string, unknown>;
  _upstream = await import('@nexusmods/nexus-api');
  return _upstream as Record<string, unknown>;
}

class RealNexusClient implements NexusClient {
  private _instance: unknown = null;

  private getApiKey(): string {
    const key = process.env['NEXUS_API_KEY'];
    if (!key) {
      throw new NexusAuthError(
        'NEXUS_API_KEY is not set. Use a personal key from nexusmods.com/users/myaccount?tab=api for dev, ' +
          'or set NEXUS_MOCK=true for offline testing.'
      );
    }
    return key;
  }

  private async getNexus(): Promise<unknown> {
    if (this._instance) return this._instance;
    const upstream = await getUpstream();
    // The Nexus class moved across export shapes over the package's
    // lifetime: ``default`` in 1.0.x, ``Nexus`` in 1.1+, ``NexusT``
    // floated briefly in pre-releases. Accept any of the three so a
    // minor bump doesn't break us. ``create`` and ``createWithOAuth``
    // are static factories that some versions prefer over the
    // constructor — we use the constructor uniformly because it's
    // the one signature stable across versions.
    type NexusCtor = new (key: string, appName: string, appVersion: string) => unknown;
    const candidates: Array<NexusCtor | undefined> = [
      upstream['Nexus'] as NexusCtor | undefined,
      upstream['NexusT'] as NexusCtor | undefined,
      upstream['default'] as NexusCtor | undefined,
    ];
    const Ctor = candidates.find((c): c is NexusCtor => typeof c === 'function');
    if (!Ctor) {
      throw new NexusApiError(
        'INVARIANT',
        '@nexusmods/nexus-api shape changed — no recognized Nexus class export'
      );
    }
    this._instance = new Ctor(this.getApiKey(), 'strong-tower-mods', '0.1.0');
    return this._instance;
  }

  private async withTranslation<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      throw translateError(err);
    }
  }

  async validate(): Promise<NexusUserValidation> {
    const nexus = await this.getNexus();
    return this.withTranslation(async () => {
      const raw = (await (nexus as { validateKey: () => Promise<unknown> }).validateKey()) as {
        user_id: number;
        name: string;
        email: string;
        is_premium: boolean;
        is_supporter: boolean;
        profile_url?: string;
      };
      return {
        userId: raw.user_id,
        username: raw.name,
        email: raw.email,
        isPremium: raw.is_premium,
        isSupporter: raw.is_supporter,
        profileUrl: raw.profile_url ?? null,
        // Nexus returns rate-limit info as response headers, not in
        // the body — for the validate call we only get the user
        // shape. The rate-limit fields are populated to the cap for
        // the user's tier so the caller has a sensible default.
        remainingDailyRequests: raw.is_premium ? 600 : 300,
        totalDailyRequests: raw.is_premium ? 600 : 300,
      };
    });
  }

  async getModInfo(gameDomain: NexusGameDomain, modId: number): Promise<NexusModInfo> {
    const nexus = await this.getNexus();
    return this.withTranslation(async () => {
      const raw = (await (
        nexus as { getModInfo: (mid: number, game: string) => Promise<Record<string, unknown>> }
      ).getModInfo(modId, gameDomain)) as Record<string, unknown> & {
        mod_id: number;
        name: string;
        summary: string;
        description: string;
        category_id: number;
        version: string;
        author: string;
        uploaded_by: string;
        uploaded_users_profile_url?: string;
        uploaded_user_id?: number;
        endorsement_count: number;
        unique_downloads: number;
        total_downloads: number;
        created_time: string;
        updated_time: string;
        status: string;
        available: boolean;
        picture_url?: string;
        allow_rating?: boolean;
      };
      return {
        modId: raw.mod_id,
        gameDomain,
        name: raw.name,
        summary: raw.summary,
        description: raw.description,
        category: raw.category_id,
        version: raw.version,
        author: raw.author,
        uploadedBy: raw.uploaded_by,
        uploadedUserId: raw.uploaded_user_id ?? 0,
        endorsementCount: raw.endorsement_count,
        uniqueDownloads: raw.unique_downloads,
        totalDownloads: raw.total_downloads,
        createdTime: raw.created_time,
        updatedTime: raw.updated_time,
        status: raw.status as NexusModInfo['status'],
        available: raw.available,
        // Nexus v1 API does not surface granular permission flags
        // on the public mod-info endpoint — they require the
        // mod-permissions endpoint behind author auth. For now we
        // assume locked-by-default, which is the safe stance for
        // any creator-derived-work gating in Phase 3.
        permissions: LOCKED_PERMISSIONS,
        pictureUrl: (raw.picture_url ?? null) as string | null,
      };
    });
  }

  async getModFiles(gameDomain: NexusGameDomain, modId: number): Promise<NexusModFile[]> {
    const nexus = await this.getNexus();
    return this.withTranslation(async () => {
      const raw = (await (
        nexus as { getModFiles: (mid: number, game: string) => Promise<{ files: Array<Record<string, unknown>> }> }
      ).getModFiles(modId, gameDomain)) as { files: Array<Record<string, unknown>> };
      return raw.files.map((f) => {
        const r = f as {
          file_id: number;
          mod_id: number;
          name: string;
          version: string;
          category_id?: number;
          category_name: string;
          is_primary?: boolean;
          file_name: string;
          size_kb: number;
          uploaded_time: string;
          changelog_html?: string;
          description?: string;
        };
        return {
          fileId: r.file_id,
          modId: r.mod_id,
          gameDomain,
          name: r.name,
          version: r.version,
          category: normalizeFileCategory(r.category_name),
          isPrimary: r.is_primary ?? false,
          fileName: r.file_name,
          fileSizeBytes: r.size_kb * 1024,
          uploadedTime: r.uploaded_time,
          changelogHtml: r.changelog_html ?? null,
          description: r.description ?? '',
        } satisfies NexusModFile;
      });
    });
  }

  async getDownloadLink(
    gameDomain: NexusGameDomain,
    modId: number,
    fileId: number
  ): Promise<NexusDownloadLink[]> {
    const nexus = await this.getNexus();
    return this.withTranslation(async () => {
      const raw = (await (
        nexus as {
          getDownloadURLs: (
            mid: number,
            fid: number,
            game: string
          ) => Promise<Array<Record<string, unknown>>>;
        }
      ).getDownloadURLs(modId, fileId, gameDomain)) as Array<Record<string, unknown>>;
      return raw.map((entry) => {
        const r = entry as { URI?: string; uri?: string; short_name?: string; ShortName?: string };
        return {
          uri: (r.URI ?? r.uri ?? '') as string,
          shortName: (r.short_name ?? r.ShortName ?? '') as string,
          shortHost: extractHost((r.URI ?? r.uri ?? '') as string),
        } satisfies NexusDownloadLink;
      });
    });
  }
}

function normalizeFileCategory(raw: string): NexusModFile['category'] {
  const lower = raw.toLowerCase();
  if (lower === 'main') return 'main';
  if (lower === 'patch') return 'patch';
  if (lower === 'optional') return 'optional';
  if (lower === 'old' || lower === 'old version' || lower === 'old_version') return 'old_version';
  if (lower === 'miscellaneous' || lower === 'misc') return 'misc';
  if (lower === 'deleted') return 'deleted';
  // Unknown category — surface as misc rather than failing the parse;
  // the user-facing UI shows the original raw category string.
  return 'misc';
}

function extractHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
}

function translateError(err: unknown): NexusApiError {
  if (err instanceof NexusApiError) return err;
  const anyErr = err as { statusCode?: number; status?: number; code?: string; message?: string };
  const status = anyErr.statusCode ?? anyErr.status;
  const message = anyErr.message ?? 'Nexus API error';
  if (status === 401 || status === 403 || anyErr.code === 'NEXUS_API_KEY_INVALID') {
    return new NexusAuthError(message);
  }
  if (status === 404) {
    return new NexusNotFoundError(message);
  }
  if (status === 429) {
    return new NexusApiError('NEXUS_RATE_LIMIT', message, 429);
  }
  if (anyErr.code === 'ENOTFOUND' || anyErr.code === 'ETIMEDOUT' || anyErr.code === 'ECONNREFUSED') {
    return new NexusUnreachableError(message);
  }
  return new NexusApiError('NEXUS_ERROR', message, status ?? 500);
}
