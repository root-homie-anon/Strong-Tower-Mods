/**
 * JWT round-trip unit tests.
 *
 * No DB, no Fastify — pure jose + the issue/verify helpers. The
 * heavier integration test that goes through the Fastify middleware
 * + DB lives in middleware.test.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { issueSessionToken, verifySessionToken } from '../src/jwt.js';

const TEST_SECRET = 'test-secret-must-be-at-least-32-chars-long-1234';

beforeAll(() => {
  process.env['JWT_SECRET'] = TEST_SECRET;
});

afterAll(() => {
  delete process.env['JWT_SECRET'];
});

describe('issueSessionToken', () => {
  test('mints a token with the requested userId, tier, and jti', async () => {
    const { token, jti, expiresAt } = await issueSessionToken({
      userId: 'user-abc',
      tier: 'premium',
      jti: 'jti-fixed',
      ttlSeconds: 60,
    });

    expect(token.split('.').length).toBe(3); // header.payload.signature
    expect(jti).toBe('jti-fixed');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 1000 + 1000);

    const claims = await verifySessionToken(token);
    expect(claims.sub).toBe('user-abc');
    expect(claims.tier).toBe('premium');
    expect(claims.jti).toBe('jti-fixed');
  });

  test('generates a unique jti when none is provided', async () => {
    const a = await issueSessionToken({ userId: 'u', tier: 'basic' });
    const b = await issueSessionToken({ userId: 'u', tier: 'basic' });
    expect(a.jti).not.toBe(b.jti);
  });
});

describe('verifySessionToken', () => {
  test('rejects a token signed with a different secret', async () => {
    const { token } = await issueSessionToken({ userId: 'u', tier: 'basic' });
    process.env['JWT_SECRET'] = 'different-secret-also-at-least-32-chars-xyz';
    await expect(verifySessionToken(token)).rejects.toThrow();
    process.env['JWT_SECRET'] = TEST_SECRET;
  });

  test('rejects an expired token', async () => {
    const { token } = await issueSessionToken({
      userId: 'u',
      tier: 'basic',
      ttlSeconds: 1,
    });
    // 1.2 s sleep beats the 1 s TTL plus any clock skew.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await expect(verifySessionToken(token)).rejects.toThrow();
  });

  test('refuses to operate without a sufficiently long JWT_SECRET', async () => {
    process.env['JWT_SECRET'] = 'too-short';
    await expect(
      issueSessionToken({ userId: 'u', tier: 'basic' })
    ).rejects.toThrow(/at least 32 chars/);
    process.env['JWT_SECRET'] = TEST_SECRET;
  });
});
