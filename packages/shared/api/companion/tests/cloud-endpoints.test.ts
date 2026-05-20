/**
 * Cloud endpoint integration tests via Fastify ``app.inject``.
 *
 * Runs the entire request/response pipeline (rate limiter, error
 * handler, schema validation, our handlers) without binding a TCP
 * port. Auth is in mock mode (AUTH_MOCK=true) so the tests don't
 * need a live ApiSession; Anthropic is in mock mode (ANTHROPIC_MOCK=
 * true) so handlers take the deterministic short-circuit path instead
 * of hitting the API.
 *
 * Each test asserts on status, response shape, AND key invariants of
 * the response — not just that the call returned 200.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  process.env['ANTHROPIC_MOCK'] = 'true';
  process.env['AUTH_MOCK'] = 'true';
  // Fastify pumps a lot of noise to stdout in test mode; turn it off.
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  delete process.env['ANTHROPIC_MOCK'];
  delete process.env['AUTH_MOCK'];
  await app.close();
});

// ---------------------------------------------------------------------------
// /health — unauthenticated smoke check
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  test('returns 200 with service identifier', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('companion-api');
  });
});

// ---------------------------------------------------------------------------
// POST /load-order/rank
// ---------------------------------------------------------------------------

describe('POST /load-order/rank', () => {
  test('returns a ranked array covering every input mod in mock mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/load-order/rank',
      headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
      payload: {
        mods: [
          { modId: 'a', name: 'A Master', kind: 'master', pluginFiles: ['A.esm'] },
          { modId: 'b', name: 'A Patch', kind: 'patch', pluginFiles: ['B.esp'] },
          { modId: 'c', name: 'A Tweak', kind: 'tweak' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      ranked: Array<{ modId: string; rank: number; rationale: string }>;
      warnings: string[];
      source: string;
    };
    expect(body.ranked).toHaveLength(3);
    expect(body.source).toBe('cloud-mock');

    // Ranks must be 0-based, contiguous, strictly increasing.
    const ranks = body.ranked.map((r) => r.rank);
    expect(ranks).toEqual([0, 1, 2]);

    // Every input modId is represented exactly once.
    const seenIds = new Set(body.ranked.map((r) => r.modId));
    expect(seenIds).toEqual(new Set(['a', 'b', 'c']));

    // Master loads first, tweak loads last — the heuristic invariants
    // the extension relies on for confident "Apply" behaviour.
    expect(body.ranked[0]?.modId).toBe('a');
    expect(body.ranked[2]?.modId).toBe('c');
  });

  test('rejects a missing authorization header with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/load-order/rank',
      payload: { mods: [] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'AUTH_ERROR' });
  });

  test('rejects a body missing the mods array with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/load-order/rank',
      headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
      payload: { bogus: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  test('rejects a body whose mods array exceeds 250 entries', async () => {
    const bigList = Array.from({ length: 251 }, (_, i) => ({
      modId: `m${i}`,
      name: `Mod ${i}`,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/load-order/rank',
      headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
      payload: { mods: bigList },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /conflict/explain
// ---------------------------------------------------------------------------

describe('POST /conflict/explain', () => {
  test('returns a non-empty text + suggestedAction in mock mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conflict/explain',
      headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
      payload: {
        finding: {
          kind: 'missing-master',
          severity: 'blocker',
          modIds: ['broken-patch'],
          resource: 'Missing.esm',
          shortDescription: 'missing-master:Missing.esm',
        },
        mods: [{ modId: 'broken-patch', name: 'Broken Patch' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { text: string; suggestedAction: string; source: string };
    expect(body.source).toBe('cloud-mock');
    expect(body.text.length).toBeGreaterThan(20);
    expect(body.suggestedAction.length).toBeGreaterThan(10);
    // The mock should mention the subject mod by name and the missing
    // resource by filename — both are useful to the user and we want a
    // regression to be obvious.
    expect(body.text).toContain('Broken Patch');
    expect(body.text).toContain('Missing.esm');
  });

  test('rejects an invalid finding.kind via schema validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conflict/explain',
      headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
      payload: {
        finding: {
          kind: 'definitely-not-a-real-kind',
          severity: 'warning',
          modIds: ['x'],
          resource: 'whatever',
          shortDescription: 'x',
        },
        mods: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('rejects a missing authorization header with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conflict/explain',
      payload: {
        finding: {
          kind: 'missing-master',
          severity: 'blocker',
          modIds: ['x'],
          resource: 'X.esm',
          shortDescription: 'x',
        },
        mods: [],
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
