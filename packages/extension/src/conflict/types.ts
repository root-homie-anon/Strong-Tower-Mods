/**
 * Domain types for the conflict-detection subpackage.
 *
 * The finding shape is intentionally additive: ``ConflictKind`` is a
 * string union so a future pass that adds record-level conflicts can
 * extend it without touching the existing detector / explainer
 * contracts. Severity is a coarse three-level scale (warning / error
 * / blocker) that maps cleanly to Vortex's notification severity.
 */

export type ConflictKind =
  | 'missing-master'
  | 'duplicate-plugin'
  | 'out-of-order-master'
  | 'plugin-without-master'
  | 'master-mismatch'
  | 'record-type-overlap';

export type ConflictSeverity = 'warning' | 'error' | 'blocker';

export interface ConflictFinding {
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** Mods directly involved. The first id is conventionally the "subject" mod. */
  modIds: string[];
  /** Resource the conflict is about (plugin filename, master filename, etc.). */
  resource: string;
  /** Short machine-readable summary, e.g. "missing-master:DLCRobot.esm". */
  shortDescription: string;
}

export interface ConflictReport {
  findings: ConflictFinding[];
  /**
   * Non-fatal observations that did not rise to a finding but the
   * detector noticed in passing (mods with no declared masters,
   * mods loaded outside their advertised range, etc.).
   */
  notes: string[];
}

export interface ConflictExplanation {
  finding: ConflictFinding;
  /**
   * One-to-three-sentence plain-English explanation suitable for the
   * Vortex notification body. Mock mode templates these from the
   * finding fields; real mode would hand them to Claude with the
   * full mod descriptions for richer phrasing.
   */
  text: string;
  /** Suggested next action the user can take from the Vortex UI. */
  suggestedAction: string;
  source: 'mock-template' | 'cloud-claude';
}
