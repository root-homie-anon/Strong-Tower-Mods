/**
 * Nexus Mods SSO client.
 *
 * The real flow:
 *
 *   1. Client opens a WebSocket to wss://sso.nexusmods.com.
 *   2. Client sends a one-shot `{ id, token, protocol: 2 }` envelope
 *      where `id` is a UUID we generate and `token` is empty for the
 *      first attempt.
 *   3. Client opens the user's browser to
 *      https://www.nexusmods.com/sso?id=<id>&application=<app_slug>.
 *   4. User clicks Authorize on Nexus.
 *   5. The WebSocket receives a `connection_token` (we cache it on the
 *      `id` for re-use across reconnects within the same SSO grant)
 *      followed by a `{ data: { api_key } }` frame with a Nexus API
 *      key scoped to our application.
 *   6. We exchange that api_key for the user profile via
 *      GET https://api.nexusmods.com/v1/users/validate.json.
 *
 * For Phase E2 the real flow is stubbed (NEXUS_SSO_MOCK=true) so the
 * rest of the stack can be built and tested before Nexus SSO
 * registration is approved. Set NEXUS_SSO_MOCK=true and call
 * `awaitConfirmation()` — it returns a deterministic mock profile
 * with a stable nexusUserId. The real implementation lands once the
 * Nexus team approves our app's SSO registration.
 */

import { randomUUID } from 'node:crypto';

export interface NexusSsoResult {
  nexusUserId: number;
  nexusUsername: string;
  email?: string;
  isPremium: boolean;
  apiKey: string;
}

export interface NexusSsoFlow {
  /** UUID we hand to the user-facing browser URL. */
  id: string;
  /** URL the client opens in the user's browser to confirm. */
  authorizeUrl: string;
  /** Resolves when the user confirms (or rejects). Rejects on timeout. */
  awaitConfirmation: (timeoutMs?: number) => Promise<NexusSsoResult>;
}

const NEXUS_APPLICATION_SLUG = 'strong-tower-mods';
const NEXUS_SSO_AUTHORIZE_URL = 'https://www.nexusmods.com/sso';

function isMockMode(): boolean {
  return process.env['NEXUS_SSO_MOCK'] === 'true';
}

/**
 * Begin an SSO flow. Returns the URL to open in the user's browser
 * and a promise that resolves with the Nexus profile once confirmed.
 *
 * The two-phase shape (start now, await later) lets the calling layer
 * show the user the URL immediately while waiting for the async
 * confirmation in the background.
 */
export function startSsoFlow(): NexusSsoFlow {
  const id = randomUUID();
  const authorizeUrl = `${NEXUS_SSO_AUTHORIZE_URL}?id=${id}&application=${NEXUS_APPLICATION_SLUG}`;

  return {
    id,
    authorizeUrl,
    awaitConfirmation: async (timeoutMs: number = 5 * 60 * 1000) => {
      if (isMockMode()) {
        return mockConfirmation(id);
      }
      // Real implementation lands when Nexus SSO registration is approved.
      // Until then, fail loudly rather than hang silently — a missing
      // mock-mode env var should not look like a timeout.
      throw new Error(
        'Real Nexus SSO is not yet implemented. Set NEXUS_SSO_MOCK=true ' +
          `to use the mock profile (timeoutMs=${timeoutMs} ignored in mock).`
      );
    },
  };
}

/**
 * Deterministic mock profile for development and tests.
 *
 * The nexusUserId is derived from the SSO flow id (first 8 hex chars
 * of the UUID, parsed as base-16) so distinct flows produce distinct
 * users — which mirrors real Nexus behavior and lets multi-user tests
 * exercise the upsert path without all sessions collapsing onto one
 * mock account.
 */
function mockConfirmation(flowId: string): NexusSsoResult {
  const idHex = flowId.replace(/-/g, '').slice(0, 8);
  const derivedUserId = parseInt(idHex, 16);
  return {
    nexusUserId: derivedUserId,
    nexusUsername: `mock-user-${idHex}`,
    email: `mock-${idHex}@example.invalid`,
    isPremium: false,
    apiKey: 'mock-nexus-api-key',
  };
}
