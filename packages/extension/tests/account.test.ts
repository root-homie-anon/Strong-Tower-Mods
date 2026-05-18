/**
 * Account-linking tests.
 *
 * No real cloud is reachable from the unit suite, so we drive
 * ``openSession`` / ``closeSession`` with a captured-fetch double
 * that records the outgoing request and returns a scripted response.
 * The end-to-end happy path against the real /session/open endpoint
 * is covered by packages/shared/api/companion's auth-flow.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import {
  openSession,
  closeSession,
  InMemorySessionStore,
  CloudUnreachableError,
  CloudRejectedError,
} from '../src/account/index.js';

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function captureFetch(response: { status: number; body: unknown } | Error): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const body = init?.body != null ? JSON.parse(init.body as string) : undefined;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body,
    });
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fakeFetch, calls };
}

describe('openSession', () => {
  test('POSTs the Nexus profile and persists the returned JWT', async () => {
    const { fetch: fetchImpl, calls } = captureFetch({
      status: 200,
      body: {
        token: 'eyJhbGciOi.SIGN.PAYLOAD',
        jti: 'jti-test-123',
        expiresAt: '2026-06-01T00:00:00.000Z',
        tier: 'premium',
      },
    });
    const store = new InMemorySessionStore();
    const stored = await openSession(
      { nexusUserId: 1234, nexusUsername: 'tester', tier: 'premium' },
      store,
      { baseUrl: 'http://api.test', fetchImpl }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/session/open');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({
      nexusUserId: 1234,
      nexusUsername: 'tester',
      tier: 'premium',
    });
    expect(stored.token).toBe('eyJhbGciOi.SIGN.PAYLOAD');
    expect(stored.jti).toBe('jti-test-123');

    const loaded = await store.load();
    expect(loaded?.jti).toBe('jti-test-123');
  });

  test('captures Custom-tier pre-auth fields when the cloud returns them', async () => {
    const { fetch: fetchImpl } = captureFetch({
      status: 200,
      body: {
        token: 'tok',
        jti: 'jti-custom',
        expiresAt: '2026-06-01T00:00:00.000Z',
        tier: 'custom',
        preAuth: { paymentIntentId: 'pi_mock_abc', amountMicrodollars: 5_000_000 },
      },
    });
    const store = new InMemorySessionStore();
    const stored = await openSession(
      { nexusUserId: 1, nexusUsername: 'cust', tier: 'custom', sessionCeilingMicrodollars: 5_000_000 },
      store,
      { baseUrl: 'http://api.test', fetchImpl }
    );
    expect(stored.paymentIntentId).toBe('pi_mock_abc');
    expect(stored.preAuthMicrodollars).toBe(5_000_000);
  });

  test('raises CloudRejectedError on a non-2xx response', async () => {
    const { fetch: fetchImpl } = captureFetch({
      status: 401,
      body: { error: 'AUTH_ERROR', message: 'bad sso token' },
    });
    const store = new InMemorySessionStore();
    await expect(
      openSession(
        { nexusUserId: 1, nexusUsername: 'x', tier: 'basic' },
        store,
        { baseUrl: 'http://api.test', fetchImpl }
      )
    ).rejects.toThrow(CloudRejectedError);
    // Nothing persisted on failure.
    expect(await store.load()).toBeNull();
  });

  test('raises CloudUnreachableError when the network call rejects', async () => {
    const { fetch: fetchImpl } = captureFetch(new Error('ECONNREFUSED'));
    const store = new InMemorySessionStore();
    await expect(
      openSession(
        { nexusUserId: 1, nexusUsername: 'x', tier: 'basic' },
        store,
        { baseUrl: 'http://unreachable', fetchImpl }
      )
    ).rejects.toThrow(CloudUnreachableError);
    expect(await store.load()).toBeNull();
  });
});

describe('closeSession', () => {
  test('returns null and is a no-op when no session is stored', async () => {
    const { fetch: fetchImpl, calls } = captureFetch({ status: 200, body: {} });
    const result = await closeSession({}, new InMemorySessionStore(), {
      baseUrl: 'http://api.test',
      fetchImpl,
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('POSTs jti + pre-auth fields and clears the store on success', async () => {
    const store = new InMemorySessionStore();
    await store.save({
      token: 'tok',
      jti: 'jti-close',
      expiresAt: '2026-06-01T00:00:00.000Z',
      tier: 'custom',
      nexusUserId: 99,
      paymentIntentId: 'pi_close',
      preAuthMicrodollars: 2_000_000,
    });

    const { fetch: fetchImpl, calls } = captureFetch({
      status: 200,
      body: { jti: 'jti-close', closedAt: '2026-05-18T10:00:00.000Z', finalMeteredMicrodollars: 12_345 },
    });
    const result = await closeSession({ actualMicrodollars: 12_345 }, store, {
      baseUrl: 'http://api.test',
      fetchImpl,
    });

    expect(calls[0]?.body).toEqual({
      jti: 'jti-close',
      actualMicrodollars: 12_345,
      paymentIntentId: 'pi_close',
      preAuthMicrodollars: 2_000_000,
    });
    expect(result?.finalMeteredMicrodollars).toBe(12_345);
    expect(await store.load()).toBeNull();
  });

  test('still clears the store on network failure (intent to log out is honoured)', async () => {
    const store = new InMemorySessionStore();
    await store.save({
      token: 'tok',
      jti: 'jti-x',
      expiresAt: '2026-06-01T00:00:00.000Z',
      tier: 'basic',
      nexusUserId: 7,
    });

    const { fetch: fetchImpl } = captureFetch(new Error('network down'));
    await expect(
      closeSession({}, store, { baseUrl: 'http://api.test', fetchImpl })
    ).rejects.toThrow(CloudUnreachableError);
    expect(await store.load()).toBeNull();
  });
});
