/**
 * Public surface of the deploy subpackage.
 *
 * The deploy parser sits at the boundary between Vortex (which
 * manages deployment / undeployment of plugin files into the game's
 * Data folder) and the rest of our extension (which needs to know
 * what happened in-game after the deploy so the creator's repair
 * loop in Phase 3 has something to act on).
 *
 * Three log formats are recognised:
 *
 *   - Buffout 4 crash logs  — the de-facto F4 crash reporter, output
 *     to ``Documents\My Games\Fallout4\F4SE\crash-<timestamp>.log``.
 *     Header carries the unhandled-exception module + address, body
 *     carries the live plugin list at crash time.
 *
 *   - F4SE.log               — F4SE's own startup log. Lines like
 *     "plugin <name> (<version>) loaded correctly". Useful for
 *     detecting plugin load failures that don't crash the game.
 *
 *   - Papyrus.0.log          — Script error stream. Lines tagged
 *     [error], [warning], [fatal]. The detector emits one event per
 *     [error]/[fatal] line.
 */

export { parseBuffoutCrash, parseF4seLog, parsePapyrusLog } from './parsers.js';
export type {
  BuffoutCrashReport,
  F4seLogReport,
  PapyrusLogReport,
  ScriptError,
  PluginLoadEvent,
} from './types.js';
