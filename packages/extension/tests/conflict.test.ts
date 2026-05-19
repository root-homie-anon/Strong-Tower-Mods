/**
 * Conflict detector + explainer tests.
 *
 * Every fixture mod list is constructed in-test so the assertions
 * stay anchored to a single visible piece of state. The detector is
 * pure; the explainer's mock mode is also pure; this whole suite
 * runs in milliseconds with no I/O.
 */

import { describe, expect, test } from 'bun:test';
import { detectConflicts, explainConflict } from '../src/conflict/index.js';
import type { ModSummary } from '../src/load-order/index.js';

function mod(partial: Partial<ModSummary> & { modId: string; name: string }): ModSummary {
  return { ...partial };
}

describe('detectConflicts — missing master', () => {
  test('flags a master not provided by any other mod and not vanilla', () => {
    const mods: ModSummary[] = [
      mod({
        modId: 'broken-patch',
        name: 'Broken Patch',
        kind: 'patch',
        pluginFiles: ['BrokenPatch.esp'],
        masters: ['NonExistent.esm'],
      }),
    ];
    const report = detectConflicts(mods);
    const missing = report.findings.find((f) => f.kind === 'missing-master');
    expect(missing).toBeDefined();
    expect(missing?.resource).toBe('NonExistent.esm');
    expect(missing?.severity).toBe('blocker');
  });

  test('does NOT flag vanilla Fallout 4 masters', () => {
    const mods: ModSummary[] = [
      mod({
        modId: 'good-patch',
        name: 'Vanilla Patch',
        kind: 'patch',
        pluginFiles: ['VanillaPatch.esp'],
        masters: ['Fallout4.esm', 'DLCRobot.esm'],
      }),
    ];
    const report = detectConflicts(mods);
    expect(report.findings.filter((f) => f.kind === 'missing-master')).toEqual([]);
  });

  test('does NOT flag a master provided by another mod in the list', () => {
    const mods: ModSummary[] = [
      mod({
        modId: 'provider',
        name: 'Settlement Framework',
        kind: 'framework',
        pluginFiles: ['Framework.esm'],
      }),
      mod({
        modId: 'addon',
        name: 'Framework Addon',
        kind: 'content',
        pluginFiles: ['Addon.esp'],
        masters: ['Framework.esm'],
      }),
    ];
    const report = detectConflicts(mods);
    expect(report.findings.filter((f) => f.kind === 'missing-master')).toEqual([]);
  });
});

describe('detectConflicts — duplicate plugin filenames', () => {
  test('flags two mods shipping the same plugin name', () => {
    const mods: ModSummary[] = [
      mod({ modId: 'a', name: 'A', kind: 'content', pluginFiles: ['Collision.esp'] }),
      mod({ modId: 'b', name: 'B', kind: 'content', pluginFiles: ['collision.ESP'] }),
    ];
    const report = detectConflicts(mods);
    const dup = report.findings.find((f) => f.kind === 'duplicate-plugin');
    expect(dup).toBeDefined();
    expect(dup?.modIds.sort()).toEqual(['a', 'b']);
    expect(dup?.severity).toBe('error');
  });
});

describe('detectConflicts — out-of-order master', () => {
  test('flags a dependent mod ranked before its master', () => {
    const mods: ModSummary[] = [
      mod({
        modId: 'provider',
        name: 'Framework',
        kind: 'framework',
        pluginFiles: ['Framework.esm'],
      }),
      mod({
        modId: 'addon',
        name: 'Addon',
        kind: 'content',
        pluginFiles: ['Addon.esp'],
        masters: ['Framework.esm'],
      }),
    ];
    // Addon ranked BEFORE its master.
    const report = detectConflicts(mods, ['addon', 'provider']);
    const ooo = report.findings.find((f) => f.kind === 'out-of-order-master');
    expect(ooo).toBeDefined();
    expect(ooo?.modIds).toEqual(['addon', 'provider']);
  });

  test('does NOT flag when the order is correct', () => {
    const mods: ModSummary[] = [
      mod({ modId: 'provider', name: 'F', kind: 'framework', pluginFiles: ['F.esm'] }),
      mod({ modId: 'addon', name: 'A', kind: 'content', pluginFiles: ['A.esp'], masters: ['F.esm'] }),
    ];
    const report = detectConflicts(mods, ['provider', 'addon']);
    expect(report.findings.filter((f) => f.kind === 'out-of-order-master')).toEqual([]);
  });

  test('writes a note explaining the skip when rankedOrder is omitted', () => {
    const mods: ModSummary[] = [mod({ modId: 'x', name: 'X', kind: 'master' })];
    const report = detectConflicts(mods);
    expect(report.notes.some((n) => n.includes('out-of-order-master'))).toBe(true);
  });
});

describe('detectConflicts — plugin without master', () => {
  test('flags a non-master mod with a plugin but no declared masters', () => {
    const mods: ModSummary[] = [
      mod({ modId: 'orphan', name: 'Orphan Patch', kind: 'patch', pluginFiles: ['Orphan.esp'] }),
    ];
    const report = detectConflicts(mods);
    expect(report.findings.find((f) => f.kind === 'plugin-without-master')).toBeDefined();
  });

  test('does NOT flag a master file with no declared masters', () => {
    const mods: ModSummary[] = [
      mod({ modId: 'm', name: 'M', kind: 'master', pluginFiles: ['M.esm'] }),
    ];
    const report = detectConflicts(mods);
    expect(report.findings.filter((f) => f.kind === 'plugin-without-master')).toEqual([]);
  });
});

describe('explainConflict (mock-template)', () => {
  test('produces a non-empty body and suggested action for each kind', async () => {
    const mods: ModSummary[] = [
      mod({ modId: 'a', name: 'Mod A', kind: 'content', pluginFiles: ['A.esp'], masters: ['Missing.esm'] }),
      mod({ modId: 'b', name: 'Mod B', kind: 'content', pluginFiles: ['B.esp'] }),
    ];
    const report = detectConflicts(mods);
    expect(report.findings.length).toBeGreaterThan(0);

    for (const finding of report.findings) {
      const explanation = await explainConflict(finding, mods);
      expect(explanation.text.length).toBeGreaterThan(30);
      expect(explanation.suggestedAction.length).toBeGreaterThan(10);
      expect(explanation.source).toBe('mock-template');
    }
  });

  test('mentions the partner mod name on out-of-order-master findings', async () => {
    const mods: ModSummary[] = [
      mod({ modId: 'addon', name: 'Cool Addon', kind: 'content', pluginFiles: ['A.esp'], masters: ['Framework.esm'] }),
      mod({ modId: 'fwk', name: 'Settlement Framework', kind: 'framework', pluginFiles: ['Framework.esm'] }),
    ];
    const report = detectConflicts(mods, ['addon', 'fwk']);
    const ooo = report.findings.find((f) => f.kind === 'out-of-order-master');
    expect(ooo).toBeDefined();
    const explanation = await explainConflict(ooo!, mods);
    expect(explanation.text).toContain('Cool Addon');
    expect(explanation.text).toContain('Settlement Framework');
  });
});
