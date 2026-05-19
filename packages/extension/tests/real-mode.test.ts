/**
 * End-to-end real-mode tests for the load-order ranker and conflict
 * explainer.
 *
 * Both modules previously had only mock-path coverage. These tests
 * drive the real cloud path via a captured-fetch double so the
 * request shapes (URL, headers, body) and the response parsing are
 * pinned without standing up the actual Fastify server.
 *
 * The matching cloud-side handlers (load-order.ts and conflict.ts)
 * have their own happy-path coverage when integrated into the cloud
 * test harness; this suite proves the extension-side contract.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rankLoadOrder } from '../src/load-order/index.js';
import { explainConflict } from '../src/conflict/index.js';
import { NexusApiError } from '../src/nexus-api/errors.js';
import type { ModSummary } from '../src/load-order/index.js';
import type { ConflictFinding } from '../src/conflict/index.js';

beforeAll(() => {
  delete process.env['RANKER_MOCK'];
  process.env['EXPLAINER_MOCK'] = 'false';
});

afterAll(() => {
  process.env['RANKER_MOCK'] = 'true';
  delete process.env['EXPLAINER_MOCK'];
});

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

describe('rankLoadOrder (real cloud)', () => {
  test('POSTs the mod list with bearer auth and returns the parsed ranking', async () => {
    const cloudBody = {
      ranked: [
        { modId: 'a', rank: 0, rationale: 'master first' },
        { modId: 'b', rank: 1, rationale: 'patch later' },
      ],
      warnings: ['note about something'],
      source: 'cloud-claude',
    };
    const { fetch: fetchImpl, calls } = captureFetch({ status: 200, body: cloudBody });

    const result = await rankLoadOrder(
      [
        { modId: 'a', name: 'Master', kind: 'master' },
        { modId: 'b', name: 'Patch', kind: 'patch' },
      ],
      { cloud: { baseUrl: 'http://api.test', token: 'tok-abc', fetchImpl } }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/load-order/rank');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok-abc');
    expect((calls[0]?.body as { mods: ModSummary[] })?.mods).toHaveLength(2);

    expect(result.ranked).toEqual(cloudBody.ranked);
    expect(result.warnings).toEqual(cloudBody.warnings);
    expect(result.source).toBe('cloud-claude');
  });

  test('raises NexusApiError on non-2xx cloud responses', async () => {
    const { fetch: fetchImpl } = captureFetch({
      status: 401,
      body: { error: 'AUTH_ERROR', message: 'expired token' },
    });
    await expect(
      rankLoadOrder([{ modId: 'a', name: 'M', kind: 'master' }], {
        cloud: { baseUrl: 'http://api.test', token: 'bad-token', fetchImpl },
      })
    ).rejects.toThrow(NexusApiError);
  });

  test('raises NexusApiError when cloud is unreachable', async () => {
    const { fetch: fetchImpl } = captureFetch(new Error('ECONNREFUSED'));
    await expect(
      rankLoadOrder([{ modId: 'a', name: 'M', kind: 'master' }], {
        cloud: { baseUrl: 'http://api.test', token: 'tok', fetchImpl },
      })
    ).rejects.toThrow(NexusApiError);
  });

  test('refuses real-mode call when options.cloud is missing', async () => {
    // The NexusApiError code is 'LOAD_ORDER_CLOUD_CONFIG_MISSING' but
    // ``rejects.toThrow(regex)`` matches against the error message,
    // not the code — assert on the user-facing message instead.
    await expect(rankLoadOrder([{ modId: 'a', name: 'M', kind: 'master' }])).rejects.toThrow(
      /requires options.cloud/
    );
  });
});

describe('explainConflict (real cloud)', () => {
  const finding: ConflictFinding = {
    kind: 'missing-master',
    severity: 'blocker',
    modIds: ['m1'],
    resource: 'Missing.esm',
    shortDescription: 'missing-master:Missing.esm',
  };

  test('POSTs the finding + mods with bearer auth and parses the response', async () => {
    const cloudBody = {
      text: 'The mod expects Missing.esm but it is not installed.',
      suggestedAction: 'Install the mod that provides Missing.esm.',
    };
    const { fetch: fetchImpl, calls } = captureFetch({ status: 200, body: cloudBody });

    const result = await explainConflict(
      finding,
      [{ modId: 'm1', name: 'Mod One' }],
      { cloud: { baseUrl: 'http://api.test', token: 'tok-xyz', fetchImpl } }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/conflict/explain');
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok-xyz');
    expect((calls[0]?.body as { finding: ConflictFinding })?.finding.kind).toBe('missing-master');

    expect(result.text).toBe(cloudBody.text);
    expect(result.suggestedAction).toBe(cloudBody.suggestedAction);
    expect(result.source).toBe('cloud-claude');
  });

  test('falls back to mock template when cloud returns non-2xx (degraded UX > error UX)', async () => {
    const { fetch: fetchImpl } = captureFetch({ status: 500, body: 'oops' });
    const result = await explainConflict(
      finding,
      [{ modId: 'm1', name: 'Mod One' }],
      { cloud: { baseUrl: 'http://api.test', token: 'tok', fetchImpl } }
    );
    expect(result.source).toBe('mock-template');
    expect(result.text.length).toBeGreaterThan(20);
  });
});
