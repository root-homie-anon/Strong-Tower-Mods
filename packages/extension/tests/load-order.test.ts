/**
 * Load-order ranker — mock-heuristic tests.
 *
 * The real cloud path is exercised manually after the
 * /load-order/rank endpoint lands; until then these tests validate
 * the heuristic that downstream Vortex integration code will
 * actually consume in dev.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rankLoadOrder, type ModSummary } from '../src/load-order/index.js';
import { NexusApiError } from '../src/nexus-api/errors.js';

beforeAll(() => {
  process.env['RANKER_MOCK'] = 'true';
});

afterAll(() => {
  delete process.env['RANKER_MOCK'];
});

function mod(partial: Partial<ModSummary> & { modId: string; name: string }): ModSummary {
  return { ...partial };
}

describe('rankLoadOrder (mock heuristic)', () => {
  test('empty input returns empty result', async () => {
    const result = await rankLoadOrder([]);
    expect(result.ranked).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test('masters first, then frameworks, then content, then patches, then tweaks', async () => {
    const result = await rankLoadOrder([
      mod({ modId: 'tweak', name: 'Damage Tweaks', kind: 'tweak' }),
      mod({ modId: 'content', name: 'New Vault', kind: 'content' }),
      mod({ modId: 'master', name: 'Big DLC', kind: 'master' }),
      mod({ modId: 'patch', name: 'Compat Patch', kind: 'patch' }),
      mod({ modId: 'framework', name: 'Settlement Framework', kind: 'framework' }),
    ]);
    expect(result.ranked.map((r) => r.modId)).toEqual([
      'master',
      'framework',
      'content',
      'patch',
      'tweak',
    ]);
    expect(result.source).toBe('mock-heuristic');
  });

  test('within the same kind bucket, ordering is alphabetical by name', async () => {
    const result = await rankLoadOrder([
      mod({ modId: 'b-content', name: 'Bravo Content', kind: 'content' }),
      mod({ modId: 'a-content', name: 'Alpha Content', kind: 'content' }),
      mod({ modId: 'c-content', name: 'Charlie Content', kind: 'content' }),
    ]);
    expect(result.ranked.map((r) => r.modId)).toEqual(['a-content', 'b-content', 'c-content']);
  });

  test('infers kind from pluginFiles when kind tag is missing (.esm => master)', async () => {
    const result = await rankLoadOrder([
      mod({ modId: 'untagged-master', name: 'Untagged Master', pluginFiles: ['MasterPlugin.esm'] }),
      mod({ modId: 'tweak', name: 'Damage Tweaks', kind: 'tweak' }),
    ]);
    expect(result.ranked[0]?.modId).toBe('untagged-master');
  });

  test('infers kind from Nexus category strings', async () => {
    const result = await rankLoadOrder([
      mod({ modId: 'patch-by-cat', name: 'Cat Patch', category: 'Bug Fixes / Patches' }),
      mod({ modId: 'fwk-by-cat', name: 'Cat Framework', category: 'Utilities / Framework' }),
    ]);
    // framework < patch in the kind order
    expect(result.ranked[0]?.modId).toBe('fwk-by-cat');
  });

  test('emits a warning for any mod the heuristic cannot classify', async () => {
    const result = await rankLoadOrder([
      mod({ modId: 'mystery', name: 'Mystery Mod' }),
      mod({ modId: 'master', name: 'A Master', kind: 'master' }),
    ]);
    expect(result.warnings.some((w) => w.includes('Mystery Mod'))).toBe(true);
    // Unknown sorts last.
    expect(result.ranked[result.ranked.length - 1]?.modId).toBe('mystery');
  });

  test('emits a no-masters warning for non-master mods without declared masters', async () => {
    const result = await rankLoadOrder([
      mod({ modId: 'no-masters', name: 'Loose Patch', kind: 'patch' }),
    ]);
    expect(result.warnings.some((w) => w.includes('declares no masters'))).toBe(true);
  });

  test('produces a non-empty rationale per ranked mod', async () => {
    const result = await rankLoadOrder([
      mod({ modId: 'a', name: 'A Master', kind: 'master' }),
      mod({ modId: 'b', name: 'A Patch', kind: 'patch' }),
    ]);
    for (const r of result.ranked) {
      expect(r.rationale.length).toBeGreaterThan(20);
    }
  });
});

describe('rankLoadOrder (real mode unimplemented)', () => {
  test('real path raises a clear NexusApiError pointing at RANKER_MOCK', async () => {
    delete process.env['RANKER_MOCK'];
    await expect(
      rankLoadOrder([{ modId: 'a', name: 'Anything', kind: 'master' }])
    ).rejects.toThrow(NexusApiError);
    process.env['RANKER_MOCK'] = 'true';
  });
});
