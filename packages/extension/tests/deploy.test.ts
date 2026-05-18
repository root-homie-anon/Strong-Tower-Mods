/**
 * Deploy log parser tests.
 *
 * Each test ships its own synthetic log string so the assertion
 * targets are visible inline. The fixtures mirror the real formats
 * Buffout 4, F4SE, and Papyrus produce.
 */

import { describe, expect, test } from 'bun:test';
import { parseBuffoutCrash, parseF4seLog, parsePapyrusLog } from '../src/deploy/index.js';

describe('parseBuffoutCrash', () => {
  test('extracts version banner, exception, module, address, and plugin list', () => {
    const raw = [
      'Fallout 4 v1.10.163',
      'Buffout 4 v1.37.0',
      '',
      'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF6AB123456 Fallout4.exe+0123456',
      '',
      '[Compatibility]',
      'F4EE: true',
      'Buffout4: true',
      '',
      'PLUGINS:',
      '[00:000]   Fallout4.esm',
      '[01:000]   DLCRobot.esm',
      '[FE:001]   ImAnEsl.esl',
      '',
      'F4SE PLUGINS:',
      '',
    ].join('\n');

    const report = parseBuffoutCrash(raw);
    expect(report.gameVersion).toBe('1.10.163');
    expect(report.buffoutVersion).toBe('1.37.0');
    expect(report.exception).toBe('EXCEPTION_ACCESS_VIOLATION');
    expect(report.module).toBe('Fallout4.exe');
    expect(report.address).toBe('0x7FF6AB123456');
    expect(report.plugins).toEqual(['Fallout4.esm', 'DLCRobot.esm', 'ImAnEsl.esl']);
    expect(report.rawInterestingLines).toContain('F4EE: true');
  });

  test('returns a sparse report on a malformed log rather than throwing', () => {
    const report = parseBuffoutCrash('totally not a crash log\nnothing to see here');
    expect(report.exception).toBeNull();
    expect(report.plugins).toEqual([]);
    expect(report.gameVersion).toBeNull();
  });

  test('handles plugin list with mixed-case extensions', () => {
    const raw = [
      'PLUGINS:',
      '[00:000]   Fallout4.ESM',
      '[01:000]   MyMod.EsP',
      '[FE:001]   tiny.esl',
    ].join('\n');
    const report = parseBuffoutCrash(raw);
    expect(report.plugins).toEqual(['Fallout4.ESM', 'MyMod.EsP', 'tiny.esl']);
  });
});

describe('parseF4seLog', () => {
  test('extracts plugin name, version, and load status', () => {
    const raw = [
      'F4SE runtime: initialize (version = 0.6.23)',
      'runtime root = C:\\Steam\\steamapps\\common\\Fallout 4\\',
      'plugin C:\\Steam\\steamapps\\common\\Fallout 4\\Data\\F4SE\\Plugins\\buffout4.dll (00000001 buffout4 010203 00000000) loaded correctly',
      'plugin C:\\Steam\\steamapps\\common\\Fallout 4\\Data\\F4SE\\Plugins\\bad.dll reported as incompatible during query',
      'plugin C:\\Steam\\steamapps\\common\\Fallout 4\\Data\\F4SE\\Plugins\\broken.dll disabled, fatal error occurred during loading',
    ].join('\n');

    const report = parseF4seLog(raw);
    expect(report.header.length).toBeGreaterThan(0);
    expect(report.pluginEvents).toHaveLength(3);

    const buffout = report.pluginEvents.find((e) => e.name === 'buffout4.dll');
    expect(buffout?.status).toBe('loaded');
    expect(buffout?.version).toBe('010203');

    const bad = report.pluginEvents.find((e) => e.name === 'bad.dll');
    expect(bad?.status).toBe('failed');

    const broken = report.pluginEvents.find((e) => e.name === 'broken.dll');
    expect(broken?.status).toBe('disabled');
  });

  test('returns empty pluginEvents on an empty file', () => {
    const report = parseF4seLog('');
    expect(report.pluginEvents).toEqual([]);
  });
});

describe('parsePapyrusLog', () => {
  test('separates errors / warnings / fatals and folds continuation lines into source', () => {
    const raw = [
      '[01/02/2026 - 03:04:05PM] warning: ScriptName.Function used a deprecated API',
      '[01/02/2026 - 03:04:06PM] error: Cannot call HasKeyword() on a None object, aborting function call',
      '\t[ (FF000800)].myScript.MyFunction() - "MyScript.psc" Line 42',
      '\t[ (FF000900)].callerScript.OnInit() - "Caller.psc" Line 10',
      '[01/02/2026 - 03:04:07PM] fatal: Catastrophic VM failure, aborting',
      '[01/02/2026 - 03:04:08PM] error: another error',
    ].join('\n');

    const report = parsePapyrusLog(raw);
    expect(report.warnings).toHaveLength(1);
    expect(report.errors).toHaveLength(2);
    expect(report.fatals).toHaveLength(1);
    expect(report.linesScanned).toBe(6);

    const firstError = report.errors[0];
    expect(firstError?.message).toContain('HasKeyword');
    // Two continuation lines were folded into source, separated by '\n'.
    expect(firstError?.source).toContain('MyScript.psc');
    expect(firstError?.source).toContain('Caller.psc');
  });

  test('returns empty buckets for a log with no events', () => {
    const report = parsePapyrusLog('Papyrus log started.\n(no events)\n');
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.fatals).toEqual([]);
    expect(report.linesScanned).toBe(3);
  });
});
