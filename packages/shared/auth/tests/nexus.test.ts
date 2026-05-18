/**
 * Nexus SSO mock-mode tests.
 *
 * The real Nexus WebSocket flow is not exercised here — it requires
 * Nexus SSO registration approval and a real user clicking through
 * the browser confirmation. That path is manually verified once
 * before Nexus release.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startSsoFlow } from '../src/nexus.js';

beforeAll(() => {
  process.env['NEXUS_SSO_MOCK'] = 'true';
});

afterAll(() => {
  delete process.env['NEXUS_SSO_MOCK'];
});

describe('startSsoFlow (mock)', () => {
  test('produces a UUID id and a populated authorize URL', () => {
    const flow = startSsoFlow();
    expect(flow.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(flow.authorizeUrl).toContain('https://www.nexusmods.com/sso');
    expect(flow.authorizeUrl).toContain(`id=${flow.id}`);
    expect(flow.authorizeUrl).toContain('application=strong-tower-mods');
  });

  test('awaitConfirmation returns a deterministic profile for a given flow', async () => {
    const flow = startSsoFlow();
    const a = await flow.awaitConfirmation();
    const b = await flow.awaitConfirmation();
    // Same flow id => same derived user. The mock is stable so tests
    // that rely on a Nexus user id staying the same across awaits do not
    // need to capture the first result.
    expect(a).toEqual(b);
    expect(a.nexusUserId).toBeGreaterThan(0);
    expect(a.nexusUsername).toContain('mock-user-');
    expect(a.apiKey).toBe('mock-nexus-api-key');
  });

  test('distinct flows yield distinct users', async () => {
    const a = await startSsoFlow().awaitConfirmation();
    const b = await startSsoFlow().awaitConfirmation();
    expect(a.nexusUserId).not.toBe(b.nexusUserId);
  });
});

describe('startSsoFlow (real mode unimplemented)', () => {
  test('awaitConfirmation throws a clear error when NEXUS_SSO_MOCK is unset', async () => {
    delete process.env['NEXUS_SSO_MOCK'];
    const flow = startSsoFlow();
    await expect(flow.awaitConfirmation(100)).rejects.toThrow(/not yet implemented/);
    process.env['NEXUS_SSO_MOCK'] = 'true';
  });
});
