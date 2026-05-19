/**
 * Orchestration-layer tests.
 *
 * Drives each Vortex action through its pure-function entry point
 * with hand-constructed inputs. These tests are the contract the
 * Vortex glue layer (vortex-init.ts) consumes — they pin the input
 * and output shapes so a future widening of vortex-api types cannot
 * accidentally break the action callbacks.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  sortLoadOrderAction,
  detectConflictsAction,
  parseLatestCrashAction,
  linkAccountAction,
  unlinkAccountAction,
  type CrashLogReader,
} from '../src/orchestration.js';
import { InMemorySessionStore } from '../src/account/index.js';
import type { ModSummary } from '../src/load-order/index.js';

beforeAll(() => {
  process.env['RANKER_MOCK'] = 'true';
});

afterAll(() => {
  delete process.env['RANKER_MOCK'];
});

describe('sortLoadOrderAction', () => {
  test('delegates to the ranker and returns the result intact', async () => {
    const mods: ModSummary[] = [
      { modId: 'a', name: 'A', kind: 'master' },
      { modId: 'b', name: 'B', kind: 'patch' },
    ];
    const result = await sortLoadOrderAction({ mods });
    expect(result.ranked).toHaveLength(2);
    expect(result.ranked[0]?.modId).toBe('a');
    expect(result.source).toBe('mock-heuristic');
  });
});

describe('detectConflictsAction', () => {
  test('joins findings with explanations in the same order', async () => {
    const mods: ModSummary[] = [
      {
        modId: 'broken',
        name: 'Broken',
        kind: 'patch',
        pluginFiles: ['Broken.esp'],
        masters: ['NotInLoad.esm'],
      },
    ];
    const { report, explanations } = await detectConflictsAction({ mods });
    expect(report.findings.length).toBeGreaterThan(0);
    expect(explanations).toHaveLength(report.findings.length);
    for (let i = 0; i < report.findings.length; i++) {
      expect(explanations[i]?.finding.kind).toBe(report.findings[i]!.kind);
    }
  });
});

describe('parseLatestCrashAction', () => {
  test('reads the newest log and returns its parsed report', async () => {
    const reader: CrashLogReader = {
      async listCrashLogs() {
        return ['crash-2026-05-18.log', 'crash-2026-05-17.log'];
      },
      async readCrashLog(name) {
        // Each fixture has a different exception so we can verify
        // we picked the first entry of listCrashLogs (the newest).
        if (name === 'crash-2026-05-18.log') {
          return 'Fallout 4 v1.10.163\nBuffout 4 v1.37.0\n\nUnhandled exception "EXCEPTION_NEW" at 0xABC Fallout4.exe+1';
        }
        return 'Fallout 4 v1.10.163\nBuffout 4 v1.37.0\n\nUnhandled exception "EXCEPTION_OLD" at 0xDEF Fallout4.exe+2';
      },
    };
    const result = await parseLatestCrashAction(reader);
    expect(result.filename).toBe('crash-2026-05-18.log');
    expect(result.report?.exception).toBe('EXCEPTION_NEW');
  });

  test('returns nulls when the crash directory is empty', async () => {
    const reader: CrashLogReader = {
      async listCrashLogs() {
        return [];
      },
      async readCrashLog() {
        throw new Error('should not be called');
      },
    };
    const result = await parseLatestCrashAction(reader);
    expect(result.filename).toBeNull();
    expect(result.report).toBeNull();
  });
});

describe('linkAccountAction / unlinkAccountAction', () => {
  test('link persists the JWT, unlink clears it', async () => {
    const store = new InMemorySessionStore();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/session/open')) {
        return new Response(
          JSON.stringify({
            token: 'tok',
            jti: 'jti-orch',
            expiresAt: '2026-06-01T00:00:00.000Z',
            tier: 'premium',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.endsWith('/session/close')) {
        return new Response(
          JSON.stringify({ jti: 'jti-orch', closedAt: '2026-05-18T10:00:00.000Z', finalMeteredMicrodollars: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const stored = await linkAccountAction(
      { nexusUserId: 1, nexusUsername: 'orch', tier: 'premium' },
      store,
      { baseUrl: 'http://api.test', fetchImpl }
    );
    expect(stored.jti).toBe('jti-orch');
    expect((await store.load())?.jti).toBe('jti-orch');

    await unlinkAccountAction(store, { baseUrl: 'http://api.test', fetchImpl });
    expect(await store.load()).toBeNull();
  });
});
