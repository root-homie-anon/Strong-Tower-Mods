/**
 * Public surface of the nexus-api subpackage.
 *
 * Consumers always go through this barrel — never reach into the
 * @nexusmods/nexus-api package directly, so the mock-vs-real switch,
 * retry policy, and type narrowing live in one auditable place.
 */

export { getClient, _resetForTests, isMockMode } from './client.js';
export {
  NexusApiError,
  NexusAuthError,
  NexusRateLimitError,
  NexusNotFoundError,
} from './errors.js';
export type {
  NexusModInfo,
  NexusModFile,
  NexusDownloadLink,
  NexusUserValidation,
  ModPermissions,
} from './types.js';
