/**
 * Pure-text parsers for the three log formats we support.
 *
 * Every parser takes a raw string (file contents read from disk) and
 * returns a JSON-friendly report. Parsers are tolerant — unknown
 * lines are either ignored or collected into a ``rawInterestingLines``
 * bucket; a malformed log never throws, it just produces a sparser
 * report. The creator's repair loop downstream is responsible for
 * deciding what to do with sparse vs. complete reports.
 */

import type {
  BuffoutCrashReport,
  F4seLogReport,
  PapyrusLogReport,
  PluginLoadEvent,
  ScriptError,
} from './types.js';

// ---------------------------------------------------------------------------
// Buffout 4 crash log
// ---------------------------------------------------------------------------

/**
 * Buffout crash header format (current as of Buffout 4 NG 1.37.x):
 *
 *   Fallout 4 v1.10.163
 *   Buffout 4 v1.37.0
 *
 *   Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF6AB123456 Fallout4.exe+0123456
 *
 *   [Compatibility]
 *   F4EE: true
 *   ...
 *
 *   PLUGINS:
 *   [00:000]   Fallout4.esm
 *   [00:001]   DLCRobot.esm
 *   ...
 *
 * The parser is intentionally regex-driven — Buffout's format has
 * shifted across versions and trying to lockstep a strict grammar
 * would break with every minor release.
 */
export function parseBuffoutCrash(raw: string): BuffoutCrashReport {
  const lines = raw.split(/\r?\n/);
  const report: BuffoutCrashReport = {
    timestamp: null,
    buffoutVersion: null,
    gameVersion: null,
    exception: null,
    module: null,
    address: null,
    plugins: [],
    rawInterestingLines: [],
  };

  let inPluginsSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Buffout occasionally prepends an ISO timestamp to the very
    // first line; the more reliable timestamp is in the file name,
    // but we capture either when present.
    if (!report.timestamp) {
      const ts = trimmed.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/);
      if (ts) report.timestamp = ts[1] ?? null;
    }

    const gameMatch = trimmed.match(/^Fallout 4 v([0-9.]+)/);
    if (gameMatch) {
      report.gameVersion = gameMatch[1] ?? null;
      continue;
    }

    const buffoutMatch = trimmed.match(/^Buffout 4 v([0-9.]+)/);
    if (buffoutMatch) {
      report.buffoutVersion = buffoutMatch[1] ?? null;
      continue;
    }

    const excMatch = trimmed.match(
      /^Unhandled exception "([^"]+)" at (0x[0-9A-Fa-f]+)\s+([^\s+]+)(\+[0-9A-Fa-f]+)?/
    );
    if (excMatch) {
      report.exception = excMatch[1] ?? null;
      report.address = excMatch[2] ?? null;
      report.module = excMatch[3] ?? null;
      continue;
    }

    if (/^PLUGINS:?$/i.test(trimmed)) {
      inPluginsSection = true;
      continue;
    }

    if (inPluginsSection) {
      // Plugin lines look like "[00:000]   Fallout4.esm". When the
      // first non-plugin-shaped line appears, the section ends.
      const pluginMatch = trimmed.match(/^\[[^\]]+\]\s+(.+\.(?:esm|esp|esl))$/i);
      if (pluginMatch) {
        report.plugins.push(pluginMatch[1] ?? trimmed);
      } else if (!trimmed.startsWith('[')) {
        inPluginsSection = false;
      }
      continue;
    }

    // Collect compatibility-section toggles and similar diagnostic
    // lines into rawInterestingLines for downstream consumers that
    // want to inspect them.
    // Buffout config keys mix letters and digits (F4EE, F4SE, etc.),
    // so the prefix character class includes \d. Values are boolean
    // flags or integer counts; quoted strings are deliberately not
    // captured here — they belong in the section-specific blocks
    // Buffout emits below the [Compatibility] header.
    if (/^[A-Z_\d]+:\s*(true|false|\d+)/.test(trimmed)) {
      report.rawInterestingLines.push(trimmed);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// F4SE startup log
// ---------------------------------------------------------------------------

/**
 * F4SE.log lines we extract:
 *
 *   F4SE runtime: initialize (version = X.Y.Z)         <-- header
 *   plugin C:\...\Data\F4SE\Plugins\foo.dll (00000001 foo 010203 00000000) loaded correctly
 *   plugin C:\...\Data\F4SE\Plugins\bad.dll reported as incompatible during query
 *   plugin C:\...\Data\F4SE\Plugins\bad.dll disabled, fatal error occurred during loading
 *
 * The format has been stable since F4SE 0.6.x.
 */
export function parseF4seLog(raw: string): F4seLogReport {
  const lines = raw.split(/\r?\n/);
  const events: PluginLoadEvent[] = [];
  const header: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('F4SE') || trimmed.startsWith('runtime root')) {
      header.push(trimmed);
      continue;
    }

    const pluginMatch = trimmed.match(/^plugin\s+(?:.*[\\/])?([^\s]+\.dll)(?:\s+\(([^)]*)\))?\s+(.+)$/i);
    if (pluginMatch) {
      const name = pluginMatch[1] ?? '';
      const parens = pluginMatch[2] ?? '';
      const tail = pluginMatch[3] ?? '';
      events.push({
        name,
        version: extractF4seVersion(parens),
        status: f4seStatusFromTail(tail),
        detail: tail || null,
      });
    }
  }

  return { pluginEvents: events, header };
}

function extractF4seVersion(parens: string): string | null {
  // The parenthetical group is "<formatVersion> <name> <pluginVersion> <unused>".
  // The 3rd token is the plugin's own version. Format varies — try
  // to surface it, fall back to null.
  if (!parens) return null;
  const parts = parens.trim().split(/\s+/);
  if (parts.length >= 3) return parts[2] ?? null;
  return null;
}

function f4seStatusFromTail(tail: string): PluginLoadEvent['status'] {
  const lower = tail.toLowerCase();
  if (lower.includes('loaded correctly')) return 'loaded';
  if (lower.includes('disabled')) return 'disabled';
  if (lower.includes('incompatible') || lower.includes('fatal error') || lower.includes('failed')) {
    return 'failed';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Papyrus.0.log
// ---------------------------------------------------------------------------

/**
 * Papyrus log lines look like:
 *
 *   [01/02/2026 - 03:04:05PM] error: Cannot call HasKeyword() on a None object, aborting function call
 *           stack:
 *           [...]
 *
 * We capture the leading bracketed timestamp, the level tag, and the
 * message body up to end-of-line. Stack frames on continuation lines
 * are folded into the parent error's ``source`` field when present.
 */
const PAPYRUS_LINE_RE = /^\[([^\]]+)\]\s+(error|warning|fatal):\s+(.+)$/i;

export function parsePapyrusLog(raw: string): PapyrusLogReport {
  const lines = raw.split(/\r?\n/);
  const all: ScriptError[] = [];
  let lastError: ScriptError | null = null;

  for (const line of lines) {
    const match = line.match(PAPYRUS_LINE_RE);
    if (match) {
      const level = (match[2]?.toLowerCase() ?? 'error') as ScriptError['level'];
      const entry: ScriptError = {
        level: level === 'error' || level === 'warning' || level === 'fatal' ? level : 'error',
        timestamp: match[1] ?? null,
        message: (match[3] ?? '').trim(),
        source: null,
      };
      all.push(entry);
      lastError = entry;
      continue;
    }
    // Continuation lines: stack frames typically start with whitespace
    // and the literal "[" of a frame coordinate. Fold them into the
    // most recent error's source.
    if (lastError && line.trim().startsWith('[')) {
      lastError.source = (lastError.source ?? '') + (lastError.source ? '\n' : '') + line.trim();
    }
  }

  return {
    errors: all.filter((e) => e.level === 'error'),
    warnings: all.filter((e) => e.level === 'warning'),
    fatals: all.filter((e) => e.level === 'fatal'),
    linesScanned: lines.length,
  };
}
