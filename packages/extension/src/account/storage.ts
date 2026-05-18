/**
 * Persistent session storage abstraction.
 *
 * The Vortex extension stores the JWT inside Vortex's per-profile
 * state so the same user's other Vortex profiles cannot inherit a
 * session that belongs to a different game/setup. Tests use the
 * in-memory implementation here; the Vortex-side implementation
 * lives in vortex-init.ts (built but not unit-tested).
 */

export interface StoredSession {
  /** JWT compact string. */
  token: string;
  /** Claims.jti — also the ApiSession.jwtJti DB key. */
  jti: string;
  /** ISO-8601 expiry timestamp. */
  expiresAt: string;
  /** Tier the session was minted for. */
  tier: string;
  /** Nexus user id at link time, for display + diagnostics. */
  nexusUserId: number;
  /** PaymentIntent id if Custom-tier pre-auth was opened. */
  paymentIntentId?: string;
  /** Pre-auth amount in microdollars, paired with paymentIntentId. */
  preAuthMicrodollars?: number;
}

export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store for tests. Per-instance state; not shared across constructions. */
export class InMemorySessionStore implements SessionStore {
  private _session: StoredSession | null = null;

  async load(): Promise<StoredSession | null> {
    return this._session;
  }

  async save(session: StoredSession): Promise<void> {
    this._session = session;
  }

  async clear(): Promise<void> {
    this._session = null;
  }
}
