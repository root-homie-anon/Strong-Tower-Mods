/**
 * Cloud session lifecycle.
 *
 * Both ``openSession`` and ``closeSession`` go over the same HTTPS
 * channel to the companion API. We use the runtime's global
 * ``fetch`` (Node 18+, Bun) so the extension does not need to pull
 * in a polyfill or a heavyweight HTTP client. The few request/
 * response shapes are declared inline because they are an exact
 * mirror of the cloud schemas in shared/api/companion/src/sessions.ts.
 *
 * The cloud base URL is passed per call (``CloudConfig.baseUrl``)
 * rather than read from env so the extension can support multiple
 * environments (prod / staging / local dev) chosen from Vortex
 * settings without restart.
 */

import { CloudUnreachableError, CloudRejectedError } from './errors.js';
import type { SessionStore, StoredSession } from './storage.js';

export interface CloudConfig {
  /** Base URL of the cloud companion API, e.g. https://api.strongtower.mods or http://127.0.0.1:8080. */
  baseUrl: string;
  /** Optional fetch implementation override for testing (default: globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

export interface OpenSessionInput {
  nexusUserId: number;
  nexusUsername: string;
  tier: string;
  /** Custom tier only — per-session pre-auth ceiling in microdollars. */
  sessionCeilingMicrodollars?: number;
}

export interface CloseSessionInput {
  /** Microdollars the session actually accrued. Cloud uses denormalized total when omitted. */
  actualMicrodollars?: number;
}

/**
 * Open a cloud session and persist the resulting JWT to the store.
 * Returns the stored session so the caller does not have to round-
 * trip through the store to read it back.
 */
export async function openSession(
  input: OpenSessionInput,
  store: SessionStore,
  config: CloudConfig
): Promise<StoredSession> {
  const fetcher = config.fetchImpl ?? globalThis.fetch;
  const url = joinUrl(config.baseUrl, '/session/open');

  const body: Record<string, unknown> = {
    nexusUserId: input.nexusUserId,
    nexusUsername: input.nexusUsername,
    tier: input.tier,
  };
  if (input.sessionCeilingMicrodollars !== undefined) {
    body['sessionCeilingMicrodollars'] = input.sessionCeilingMicrodollars;
  }

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new CloudUnreachableError(
      `POST ${url} failed before a response: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '<no body>');
    throw new CloudRejectedError(
      `Cloud /session/open returned ${response.status}: ${text}`,
      response.status
    );
  }

  // Cloud response shape mirrors registerSessions in shared/api/companion.
  const raw = (await response.json()) as {
    token: string;
    jti: string;
    expiresAt: string;
    tier: string;
    preAuth?: { paymentIntentId: string; amountMicrodollars: number };
  };

  const stored: StoredSession = {
    token: raw.token,
    jti: raw.jti,
    expiresAt: raw.expiresAt,
    tier: raw.tier,
    nexusUserId: input.nexusUserId,
    ...(raw.preAuth
      ? {
          paymentIntentId: raw.preAuth.paymentIntentId,
          preAuthMicrodollars: raw.preAuth.amountMicrodollars,
        }
      : {}),
  };
  await store.save(stored);
  return stored;
}

/**
 * Close the cloud session and clear it from the store. Idempotent —
 * if no session is stored, the function is a no-op and returns null
 * rather than throwing, because users may invoke "Log out" from the
 * Vortex UI even when nothing is linked.
 */
export async function closeSession(
  input: CloseSessionInput,
  store: SessionStore,
  config: CloudConfig
): Promise<{ closedAt: string | null; finalMeteredMicrodollars: number } | null> {
  const existing = await store.load();
  if (!existing) return null;

  const fetcher = config.fetchImpl ?? globalThis.fetch;
  const url = joinUrl(config.baseUrl, '/session/close');

  const body: Record<string, unknown> = { jti: existing.jti };
  if (input.actualMicrodollars !== undefined) body['actualMicrodollars'] = input.actualMicrodollars;
  if (existing.paymentIntentId) body['paymentIntentId'] = existing.paymentIntentId;
  if (existing.preAuthMicrodollars !== undefined) {
    body['preAuthMicrodollars'] = existing.preAuthMicrodollars;
  }

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // We still clear the store on a network failure — the user's
    // intent was to log out, and a stale token left in the profile
    // store after they hit Log Out would confuse them later. The
    // cloud-side session will time out on its own.
    await store.clear();
    throw new CloudUnreachableError(
      `POST ${url} failed before a response: ${(err as Error).message}`
    );
  }

  // Clear regardless of cloud response — we don't want to leave the
  // user "half-linked" if the cloud accepted the close but the
  // network glitched on the reply.
  await store.clear();

  if (!response.ok) {
    const text = await response.text().catch(() => '<no body>');
    throw new CloudRejectedError(
      `Cloud /session/close returned ${response.status}: ${text}`,
      response.status
    );
  }

  const raw = (await response.json()) as {
    jti: string;
    closedAt: string | null;
    finalMeteredMicrodollars: number;
  };
  return {
    closedAt: raw.closedAt,
    finalMeteredMicrodollars: raw.finalMeteredMicrodollars,
  };
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
