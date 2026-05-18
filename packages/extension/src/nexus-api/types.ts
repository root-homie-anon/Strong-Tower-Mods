/**
 * Domain types for our use of the Nexus Mods API.
 *
 * The upstream @nexusmods/nexus-api package returns very loose types
 * (lots of any, lots of optional fields the API actually always
 * returns). We narrow them here to the shape our extension actually
 * uses so call sites can rely on the contract without defensive
 * coding for fields that have been documented as required since the
 * v1 API ships.
 *
 * Reference: https://app.swaggerhub.com/apis-docs/NexusMods/nexus-mods_public_api_params_in_form_data/1.0
 */

export type NexusGameDomain = 'fallout4' | 'skyrimspecialedition' | 'fallout4vr';

/** Mod metadata as returned by GET /v1/games/{game}/mods/{mod_id}.json */
export interface NexusModInfo {
  modId: number;
  gameDomain: NexusGameDomain;
  name: string;
  summary: string;
  description: string;
  category: number;
  version: string;
  author: string;
  uploadedBy: string;
  uploadedUserId: number;
  endorsementCount: number;
  uniqueDownloads: number;
  totalDownloads: number;
  /** ISO-8601 string. */
  createdTime: string;
  /** ISO-8601 string. */
  updatedTime: string;
  status: 'published' | 'not_published' | 'hidden' | 'under_moderation' | 'removed' | 'wastebinned';
  available: boolean;
  permissions: ModPermissions;
  pictureUrl: string | null;
}

/**
 * Permissions flags from the mod's author. Drives our gating on
 * derivative work, addons, and inspired-by builds in Phase 3
 * (creator). The boolean meaning is verbatim from Nexus's UI prompts.
 */
export interface ModPermissions {
  /** Author allows hosting on other sites. */
  allowOtherHosting: boolean;
  /** Author allows derivative work without contact. */
  allowDerivatives: boolean;
  /** Author allows the mod to be used in modpacks. */
  allowModpacks: boolean;
  /** Author allows uploading translations. */
  allowTranslations: boolean;
  /** Author allows changes to the mod to be uploaded as separate mods. */
  allowChanges: boolean;
}

/** Single downloadable file under a mod. */
export interface NexusModFile {
  fileId: number;
  modId: number;
  gameDomain: NexusGameDomain;
  name: string;
  version: string;
  category: 'main' | 'patch' | 'optional' | 'old_version' | 'misc' | 'deleted';
  isPrimary: boolean;
  fileName: string;
  fileSizeBytes: number;
  uploadedTime: string;
  changelogHtml: string | null;
  description: string;
}

/** A one-shot download URL valid for a few minutes. */
export interface NexusDownloadLink {
  uri: string;
  shortName: string;
  /** CDN host serving this URL — useful for retry on a different node. */
  shortHost: string;
}

/** Response from GET /v1/users/validate.json — the API-key probe. */
export interface NexusUserValidation {
  userId: number;
  username: string;
  email: string;
  isPremium: boolean;
  isSupporter: boolean;
  profileUrl: string | null;
  /** Remaining requests in the current rate window. */
  remainingDailyRequests: number;
  /** Total cap for the current window — 600 premium, 300 free. */
  totalDailyRequests: number;
}
