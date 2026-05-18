/**
 * Public entry point for @strong-tower/extension.
 *
 * The Vortex extension is structured into four pure-logic modules
 * (testable without Vortex installed) plus a Vortex-glue layer that
 * wires them into the running mod manager:
 *
 *   nexus-api/  — typed async wrapper around @nexusmods/nexus-api,
 *                 mock-mode for tests
 *   load-order/ — AI-curated load order ranker; calls the cloud
 *                 companion API with the user's mod list and asks
 *                 Claude for an ordering + plain-English rationale
 *   conflict/   — ESP header parser + Claude-backed explainer that
 *                 turns record overrides and framework version
 *                 mismatches into prose findings
 *   deploy/     — game log parser; structures Fallout 4 / F4SE log
 *                 output for the creator's repair loop in Phase 3
 *   account/    — Vortex-side glue for the Strong Tower Mods SSO
 *                 flow; exchanges a Nexus identity for a JWT against
 *                 /session/open on the companion API
 *
 * The Vortex entry point (vortex-init.ts) is built but cannot run
 * outside the Vortex process — it's loaded by Vortex via dynamic
 * require of the packed extension folder.
 */

export * as nexusApi from './nexus-api/index.js';
export * as loadOrder from './load-order/index.js';
export * as conflict from './conflict/index.js';
export * as deploy from './deploy/index.js';
export * as account from './account/index.js';
export * as orchestration from './orchestration.js';
