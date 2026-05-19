/**
 * Public surface of the conflict-detection subpackage.
 *
 * Operates on the same ``ModSummary`` shape the load-order ranker
 * consumes — both pull from Vortex's persistent mod state — so the
 * extension can feed one pre-built list through both passes without
 * a second metadata round-trip to Nexus.
 *
 * Today's detector is metadata-driven: it looks at declared masters,
 * plugin filenames, and load-order positions, and surfaces three
 * classes of finding (missing master, duplicate plugin, out-of-order
 * master). A future revision will add ESP record-level conflict
 * detection by parsing the binary plugin headers; that work is
 * gated on having a small corpus of synthetic test ESPs to fixture
 * against.
 */

export { detectConflicts } from './detector.js';
export {
  explainConflict,
  isMockMode,
  type ExplainerOptions,
  type CloudExplainerConfig,
} from './explainer.js';
export {
  parseEspHeader,
  EspParseError,
  type EspHeader,
} from './esp-parser.js';
export type {
  ConflictFinding,
  ConflictKind,
  ConflictReport,
  ConflictExplanation,
} from './types.js';
