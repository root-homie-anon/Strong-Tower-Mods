/**
 * Companion-API entry point.
 *
 * Boots the Fastify instance defined in app.ts and binds it to
 * 127.0.0.1:CLOUD_PORT. Production deployments front this with a
 * reverse proxy that handles TLS and the public IP — the Fastify
 * instance itself never listens on 0.0.0.0.
 */

import { buildApp } from './app.js';
import { validateAnthropicConfig } from './claude.js';
import { validateAuthConfig } from './auth.js';

const PORT = parseInt(process.env['CLOUD_PORT'] ?? '8080', 10);

// Fail fast on bad config so an operator misconfiguration is obvious
// in the process-exit code, not in a 502 to the first user that hits
// /companion/turn. Tests that import buildApp() directly skip this
// path by going through buildApp() instead of server.ts.
//
// Both checks are independent; we run them in sequence so the
// operator sees both messages if both are wrong (rather than fixing
// one only to discover the other on the next boot attempt).
const anthropicOk = validateAnthropicConfig();
const authOk = validateAuthConfig();
if (!anthropicOk || !authOk) {
  process.exit(1);
}

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
