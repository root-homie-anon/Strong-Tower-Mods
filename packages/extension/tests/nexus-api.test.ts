/**
 * Mock-mode tests for the Nexus API client.
 *
 * The real client is exercised manually with a personal API key
 * before each release — it's network-bound and has rate limits, so
 * keeping the suite hermetic protects everyone's daily quota.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  getClient,
  isMockMode,
  _resetForTests,
  NexusAuthError,
} from '../src/nexus-api/index.js';

beforeAll(() => {
  process.env['NEXUS_MOCK'] = 'true';
  _resetForTests();
});

afterAll(() => {
  delete process.env['NEXUS_MOCK'];
  _resetForTests();
});

beforeEach(() => {
  _resetForTests();
});

describe('mock mode', () => {
  test('isMockMode reads the env at call time', () => {
    expect(isMockMode()).toBe(true);
  });

  test('validate() returns a deterministic premium user', async () => {
    const result = await getClient().validate();
    expect(result.userId).toBe(9_900_001);
    expect(result.username).toBe('mock-tester');
    expect(result.isPremium).toBe(true);
    expect(result.totalDailyRequests).toBe(600);
  });

  test('getModInfo() returns the expected shape for an arbitrary modId', async () => {
    const info = await getClient().getModInfo('fallout4', 1234);
    expect(info.modId).toBe(1234);
    expect(info.gameDomain).toBe('fallout4');
    expect(info.endorsementCount).toBe(12_340);
    expect(info.permissions.allowDerivatives).toBe(true);
  });

  test('getModInfo() returns locked permissions for fixture mods 200, 201', async () => {
    const locked = await getClient().getModInfo('fallout4', 200);
    expect(locked.permissions.allowDerivatives).toBe(false);
    expect(locked.permissions.allowModpacks).toBe(false);
  });

  test('getModFiles() returns at least one primary main file', async () => {
    const files = await getClient().getModFiles('fallout4', 1234);
    expect(files.length).toBeGreaterThan(0);
    const primary = files.find((f) => f.isPrimary);
    expect(primary).toBeDefined();
    expect(primary?.category).toBe('main');
  });

  test('getDownloadLink() returns at least one mirror entry', async () => {
    const links = await getClient().getDownloadLink('fallout4', 1234, 1234_001);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.shortHost).toBe('mock-cdn');
  });

  test('client is cached across calls in the same mode', () => {
    const a = getClient();
    const b = getClient();
    expect(a).toBe(b);
  });
});

describe('mode switching', () => {
  test('flipping NEXUS_MOCK off invalidates the cached client', () => {
    process.env['NEXUS_MOCK'] = 'true';
    const mockClient = getClient();
    process.env['NEXUS_MOCK'] = 'false';
    const realClient = getClient();
    expect(realClient).not.toBe(mockClient);
    process.env['NEXUS_MOCK'] = 'true';
    _resetForTests();
  });
});

describe('real mode without an API key', () => {
  test('validate() raises NexusAuthError when NEXUS_API_KEY is missing', async () => {
    process.env['NEXUS_MOCK'] = 'false';
    delete process.env['NEXUS_API_KEY'];
    _resetForTests();
    await expect(getClient().validate()).rejects.toThrow(NexusAuthError);
    process.env['NEXUS_MOCK'] = 'true';
    _resetForTests();
  });
});
