/**
 * Vortex action orchestration.
 *
 * Each ``…Action`` here is the function the Vortex glue layer
 * (vortex-init.ts) hands its registered button/menu callback. The
 * orchestration layer is intentionally Vortex-agnostic: it takes the
 * resources it needs (filesystem reader, current mod list, session
 * store, cloud config) as parameters and returns a plain result.
 * That keeps every action unit-testable in isolation and lets the
 * Vortex glue stay a thin wiring file the user can finalise the
 * moment they have Vortex installed locally.
 */

import {
  detectConflicts,
  explainConflict,
  type ConflictExplanation,
  type ConflictReport,
  type ExplainerOptions,
} from './conflict/index.js';
import {
  rankLoadOrder,
  type ModSummary,
  type RankingResult,
  type RankerOptions,
} from './load-order/index.js';
import {
  parseBuffoutCrash,
  type BuffoutCrashReport,
} from './deploy/index.js';
import {
  openSession,
  closeSession,
  type CloudConfig,
  type SessionStore,
  type StoredSession,
} from './account/index.js';

// ---------------------------------------------------------------------------
// Sort load order
// ---------------------------------------------------------------------------

export interface SortLoadOrderInput {
  mods: ModSummary[];
  /** Cloud config when calling the real /load-order/rank endpoint. */
  cloud?: RankerOptions['cloud'];
}

export async function sortLoadOrderAction(
  input: SortLoadOrderInput
): Promise<RankingResult> {
  return rankLoadOrder(input.mods, input.cloud ? { cloud: input.cloud } : undefined);
}

// ---------------------------------------------------------------------------
// Detect conflicts (plus pre-rendered explanations)
// ---------------------------------------------------------------------------

export interface DetectConflictsInput {
  mods: ModSummary[];
  /** Current load order modIds; omit to skip the out-of-order pass. */
  rankedOrder?: string[];
  /** Cloud config when calling the real /conflict/explain endpoint. */
  cloud?: ExplainerOptions['cloud'];
}

export interface DetectConflictsResult {
  report: ConflictReport;
  /** One explanation per finding, in the same order. */
  explanations: ConflictExplanation[];
}

export async function detectConflictsAction(
  input: DetectConflictsInput
): Promise<DetectConflictsResult> {
  const report = detectConflicts(input.mods, input.rankedOrder);
  const options: ExplainerOptions | undefined = input.cloud ? { cloud: input.cloud } : undefined;
  // Per-finding explanations are independent — fire them in parallel.
  // Each cloud call is ~300-600 ms; doing them serially would make
  // a 5-finding report feel sluggish in the Vortex notification list.
  const explanations = await Promise.all(
    report.findings.map((f) => explainConflict(f, input.mods, options))
  );
  return { report, explanations };
}

// ---------------------------------------------------------------------------
// Parse latest crash log
// ---------------------------------------------------------------------------

/**
 * Abstraction over the filesystem so the action stays unit-testable.
 * In Vortex this is backed by ``fs/promises``; in tests the suite
 * supplies an in-memory implementation.
 */
export interface CrashLogReader {
  /** List crash log filenames in the crash-log directory, newest first. */
  listCrashLogs(): Promise<string[]>;
  /** Read a single crash log by name. */
  readCrashLog(name: string): Promise<string>;
}

export interface ParseLatestCrashResult {
  /** The filename that was parsed, or null when the directory is empty. */
  filename: string | null;
  /** Parsed report, or null when the directory is empty. */
  report: BuffoutCrashReport | null;
}

export async function parseLatestCrashAction(
  reader: CrashLogReader
): Promise<ParseLatestCrashResult> {
  const names = await reader.listCrashLogs();
  if (names.length === 0) return { filename: null, report: null };
  const newest = names[0] ?? null;
  if (!newest) return { filename: null, report: null };
  const raw = await reader.readCrashLog(newest);
  return { filename: newest, report: parseBuffoutCrash(raw) };
}

// ---------------------------------------------------------------------------
// Link / unlink Strong Tower Mods account
// ---------------------------------------------------------------------------

export interface LinkAccountInput {
  nexusUserId: number;
  nexusUsername: string;
  tier: string;
  sessionCeilingMicrodollars?: number;
}

export async function linkAccountAction(
  input: LinkAccountInput,
  store: SessionStore,
  config: CloudConfig
): Promise<StoredSession> {
  // openSession persists + returns; we just forward it so the UI
  // can show the user's new tier and expiry immediately.
  return openSession(input, store, config);
}

export async function unlinkAccountAction(
  store: SessionStore,
  config: CloudConfig,
  actualMicrodollars?: number
): Promise<{ closedAt: string | null; finalMeteredMicrodollars: number } | null> {
  const close: { actualMicrodollars?: number } =
    actualMicrodollars !== undefined ? { actualMicrodollars } : {};
  return closeSession(close, store, config);
}
