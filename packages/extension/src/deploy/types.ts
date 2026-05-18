/**
 * Domain types for deployment log parsing.
 *
 * All shapes are JSON-friendly (no Date, no Buffer) so they round-
 * trip cleanly through Vortex's persistent state store and through
 * the cloud companion API for AI-assisted repair suggestions.
 */

export interface BuffoutCrashReport {
  /** ISO-8601 timestamp parsed from the log header. Null if absent. */
  timestamp: string | null;
  /** Buffout version string from the banner. Null if not found. */
  buffoutVersion: string | null;
  /** Fallout 4 version string from the banner. Null if not found. */
  gameVersion: string | null;
  /** Unhandled exception code (e.g. "EXCEPTION_ACCESS_VIOLATION"). Null if not parsed. */
  exception: string | null;
  /** Module the exception fired in, e.g. "Fallout4.exe" or "MyMod.dll". */
  module: string | null;
  /** Pretty-printed virtual address ("0x7FF6_AB12_3456"). */
  address: string | null;
  /** Ordered plugin list (esm + esp + esl) extracted from the PLUGINS section. */
  plugins: string[];
  /** Lines we recognised but did not turn into structured fields. Useful for unknown formats. */
  rawInterestingLines: string[];
}

export interface PluginLoadEvent {
  /** Plugin name as printed by F4SE, e.g. "f4ee.dll" or "buffout4.dll". */
  name: string;
  /** Optional version string the plugin reported. */
  version: string | null;
  /** Status as detected from the log line. */
  status: 'loaded' | 'failed' | 'disabled' | 'unknown';
  /** Free-form reason F4SE printed (failure messages, version mismatch notes). */
  detail: string | null;
}

export interface F4seLogReport {
  pluginEvents: PluginLoadEvent[];
  /** Header banner lines (F4SE version, runtime version, etc.). */
  header: string[];
}

export interface ScriptError {
  /** Log level tag — Papyrus uses 'error', 'warning', 'fatal'. */
  level: 'error' | 'warning' | 'fatal';
  /** Timestamp string as printed; format varies between game runs. */
  timestamp: string | null;
  /** Single-line message body. */
  message: string;
  /** Script + function the error originated in, when present. */
  source: string | null;
}

export interface PapyrusLogReport {
  errors: ScriptError[];
  warnings: ScriptError[];
  fatals: ScriptError[];
  /** Total number of lines scanned — useful for progress bars in long log windows. */
  linesScanned: number;
}
