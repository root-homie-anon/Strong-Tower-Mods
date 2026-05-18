/**
 * Public surface of the account-linking subpackage.
 *
 * The extension's relationship with the Strong Tower Mods cloud is
 * one JWT-bound session at a time. ``openSession`` mints that JWT by
 * POSTing the user's Nexus profile to ``/session/open``;
 * ``closeSession`` is the matching POST to ``/session/close``.
 * Between those two calls the JWT lives in :class:`SessionStore` —
 * an interface so Vortex's persistent profile store and the
 * in-memory test store satisfy the same contract.
 */

export { openSession, closeSession, type CloudConfig } from './session.js';
export { InMemorySessionStore, type SessionStore, type StoredSession } from './storage.js';
export {
  AccountLinkError,
  CloudUnreachableError,
  CloudRejectedError,
} from './errors.js';
