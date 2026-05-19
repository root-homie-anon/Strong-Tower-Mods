/**
 * ESP-driven conflict detection tests.
 *
 * Exercise the two new finding kinds (master-mismatch,
 * record-type-overlap) and verify the metadata-only passes still
 * work when ``espData`` is supplied. Each test constructs an
 * EspHeader map directly — the binary parser has its own coverage
 * in esp-parser.test.ts, so we don't re-bake bytes here.
 */

import { describe, expect, test } from 'bun:test';
import {
  detectConflicts,
  explainConflict,
  type EspHeader,
} from '../src/conflict/index.js';
import type { ModSummary } from '../src/load-order/index.js';

function header(partial: Partial<EspHeader> = {}): EspHeader {
  return {
    magic: 'TES4',
    version: 1.0,
    declaredRecordCount: 0,
    author: null,
    description: null,
    masters: [],
    topLevelGroups: [],
    isLight: false,
    isMaster: false,
    ...partial,
  };
}

describe('detectConflicts with ESP data', () => {
  test('flags master-mismatch when declared masters disagree with TES4 MAST entries', () => {
    const mods: ModSummary[] = [
      {
        modId: 'patch',
        name: 'Patch',
        kind: 'patch',
        pluginFiles: ['Patch.esp'],
        masters: ['Fallout4.esm', 'OldMaster.esp'],
      },
    ];
    const espData = new Map<string, EspHeader>([
      ['patch', header({ masters: ['Fallout4.esm', 'NewMaster.esp'] })],
    ]);

    const report = detectConflicts(mods, undefined, espData);
    const mismatch = report.findings.find((f) => f.kind === 'master-mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe('warning');
    // The resource string carries both the only-declared and only-actual
    // entries; either way we expect both names present (lowercased).
    expect(mismatch?.resource.toLowerCase()).toContain('oldmaster.esp');
    expect(mismatch?.resource.toLowerCase()).toContain('newmaster.esp');
  });

  test('does NOT flag master-mismatch when declared and actual masters agree', () => {
    const mods: ModSummary[] = [
      {
        modId: 'ok',
        name: 'OK Mod',
        kind: 'patch',
        pluginFiles: ['OK.esp'],
        masters: ['Fallout4.esm'],
      },
    ];
    const espData = new Map<string, EspHeader>([
      ['ok', header({ masters: ['Fallout4.esm'] })],
    ]);
    const report = detectConflicts(mods, undefined, espData);
    expect(report.findings.filter((f) => f.kind === 'master-mismatch')).toEqual([]);
  });

  test('flags record-type-overlap for two mods touching the same record type', () => {
    const mods: ModSummary[] = [
      { modId: 'a', name: 'A', kind: 'content', pluginFiles: ['A.esp'], masters: ['Fallout4.esm'] },
      { modId: 'b', name: 'B', kind: 'content', pluginFiles: ['B.esp'], masters: ['Fallout4.esm'] },
    ];
    const espData = new Map<string, EspHeader>([
      ['a', header({ topLevelGroups: ['CELL', 'NPC_', 'ARMO'] })],
      ['b', header({ topLevelGroups: ['CELL', 'WEAP'] })],
    ]);
    const report = detectConflicts(mods, undefined, espData);
    const overlap = report.findings.find((f) => f.kind === 'record-type-overlap');
    expect(overlap).toBeDefined();
    expect(overlap?.resource).toBe('CELL');
    expect(overlap?.modIds.sort()).toEqual(['a', 'b']);
  });

  test('does NOT flag record-type-overlap when only one mod touches a type', () => {
    const mods: ModSummary[] = [
      { modId: 'a', name: 'A', kind: 'content', pluginFiles: ['A.esp'], masters: ['Fallout4.esm'] },
      { modId: 'b', name: 'B', kind: 'content', pluginFiles: ['B.esp'], masters: ['Fallout4.esm'] },
    ];
    const espData = new Map<string, EspHeader>([
      ['a', header({ topLevelGroups: ['NPC_'] })],
      ['b', header({ topLevelGroups: ['WEAP'] })],
    ]);
    const report = detectConflicts(mods, undefined, espData);
    expect(report.findings.filter((f) => f.kind === 'record-type-overlap')).toEqual([]);
  });

  test('records a note when espData is omitted, leaving ESP passes off', () => {
    const mods: ModSummary[] = [{ modId: 'x', name: 'X', kind: 'master' }];
    const report = detectConflicts(mods);
    expect(report.notes.some((n) => n.includes('ESP-derived passes'))).toBe(true);
  });
});

describe('explainConflict for new finding kinds', () => {
  test('master-mismatch explanation mentions the differing master(s) and a refresh action', async () => {
    const explanation = await explainConflict(
      {
        kind: 'master-mismatch',
        severity: 'warning',
        modIds: ['mod1'],
        resource: 'oldmaster.esp,newmaster.esp',
        shortDescription: 'master-mismatch:mod1',
      },
      [{ modId: 'mod1', name: 'Mod One' }]
    );
    expect(explanation.text).toContain('Mod One');
    expect(explanation.text.toLowerCase()).toContain('disagree');
    expect(explanation.suggestedAction.toLowerCase()).toMatch(/reinstall|xedit/);
  });

  test('record-type-overlap explanation lists the record type and involved mods', async () => {
    const explanation = await explainConflict(
      {
        kind: 'record-type-overlap',
        severity: 'warning',
        modIds: ['a', 'b'],
        resource: 'CELL',
        shortDescription: 'record-type-overlap:CELL',
      },
      [
        { modId: 'a', name: 'Mod A' },
        { modId: 'b', name: 'Mod B' },
      ]
    );
    expect(explanation.text).toContain('CELL');
    expect(explanation.text).toContain('a');
    expect(explanation.text).toContain('b');
    expect(explanation.suggestedAction.toLowerCase()).toContain('load order');
  });
});
