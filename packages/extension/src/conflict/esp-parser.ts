/**
 * Minimal Bethesda ESP/ESM/ESL binary parser.
 *
 * We do NOT parse plugin contents — only the header (TES4 record)
 * and the top-level group labels. That's enough to recover the
 * authoritative master list and the set of record types this plugin
 * touches, which together drive two new conflict-detection passes:
 *
 *   - **master-mismatch**: actual TES4 MAST entries disagree with
 *     what the Vortex metadata told us.
 *   - **record-type-overlap**: two plugins both contain top-level
 *     groups of the same type (e.g. both touch CELL records). Not a
 *     hard conflict, but a strong signal that one plugin overrides
 *     records from the other.
 *
 * Deeper formID-level conflict detection is deferred — it requires
 * walking every record body, decoding compressed sub-records, and
 * mapping local formIDs through the master table. The work pays off
 * meaningfully only with a corpus of real plugins to validate
 * against, which we don't have in the test suite today.
 *
 * Format reference: UESP wiki "Tes4Mod:File Format" (the format is
 * stable across Fallout 4 / Skyrim SE / Starfield because they all
 * use the same record container; only the subrecord vocabulary
 * differs).
 */

const RECORD_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;

const MAGIC_TES4 = 'TES4';
const MAGIC_GRUP = 'GRUP';

const SUBRECORD_HEDR = 'HEDR';
const SUBRECORD_MAST = 'MAST';
const SUBRECORD_CNAM = 'CNAM';
const SUBRECORD_SNAM = 'SNAM';

const GROUP_TYPE_TOP = 0;

/**
 * Result of parsing the TES4 header and the top-level group labels
 * of an ESP/ESM/ESL file.
 */
export interface EspHeader {
  /** Magic identifier as parsed. Always 'TES4' for valid files. */
  magic: string;
  /** Version float from the HEDR subrecord, or null if absent. */
  version: number | null;
  /** Number of records as declared by HEDR.numRecords (informational). */
  declaredRecordCount: number | null;
  /** Author from CNAM, when present. */
  author: string | null;
  /** Description from SNAM, when present. */
  description: string | null;
  /** Master filenames in the order they were declared. */
  masters: string[];
  /** Record types (4-char codes) of every top-level group in the file. */
  topLevelGroups: string[];
  /** True if the ESL flag (0x00000200) is set in the TES4 record. */
  isLight: boolean;
  /** True if the master flag (0x00000001) is set in the TES4 record. */
  isMaster: boolean;
}

/**
 * Error raised when the input bytes are not a recognisable Bethesda
 * plugin file. Caller treats this the same as "no ESP data
 * available" — the metadata-driven detector still produces findings.
 */
export class EspParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EspParseError';
  }
}

/**
 * Parse an ESP/ESM/ESL byte buffer. Returns the header + the set of
 * top-level group labels found AFTER the TES4 record. The function
 * never throws on plain "this is short / truncated / corrupt" — it
 * returns whatever it managed to recover with the remaining buckets
 * empty.
 */
export function parseEspHeader(bytes: Uint8Array): EspHeader {
  if (bytes.length < RECORD_HEADER_SIZE) {
    throw new EspParseError(
      `Buffer too short to be a plugin file (${bytes.length} bytes, need at least ${RECORD_HEADER_SIZE})`
    );
  }

  const magic = readAscii(bytes, 0, 4);
  if (magic !== MAGIC_TES4) {
    throw new EspParseError(
      `Expected ${MAGIC_TES4} magic at offset 0, got ${JSON.stringify(magic)}`
    );
  }

  const dataSize = readUint32LE(bytes, 4);
  const flags = readUint32LE(bytes, 8);
  const isMaster = (flags & 0x00000001) !== 0;
  const isLight = (flags & 0x00000200) !== 0;

  // Subrecords span [RECORD_HEADER_SIZE, RECORD_HEADER_SIZE + dataSize)
  const subEnd = Math.min(bytes.length, RECORD_HEADER_SIZE + dataSize);

  let version: number | null = null;
  let declaredRecordCount: number | null = null;
  let author: string | null = null;
  let description: string | null = null;
  const masters: string[] = [];

  let cursor = RECORD_HEADER_SIZE;
  while (cursor + SUBRECORD_HEADER_SIZE <= subEnd) {
    const subType = readAscii(bytes, cursor, 4);
    const subSize = readUint16LE(bytes, cursor + 4);
    const dataStart = cursor + SUBRECORD_HEADER_SIZE;
    const dataEnd = dataStart + subSize;
    if (dataEnd > subEnd) break;

    switch (subType) {
      case SUBRECORD_HEDR:
        if (subSize >= 12) {
          version = readFloat32LE(bytes, dataStart);
          declaredRecordCount = readInt32LE(bytes, dataStart + 4);
        }
        break;
      case SUBRECORD_MAST:
        masters.push(readCString(bytes, dataStart, subSize));
        break;
      case SUBRECORD_CNAM:
        author = readCString(bytes, dataStart, subSize);
        break;
      case SUBRECORD_SNAM:
        description = readCString(bytes, dataStart, subSize);
        break;
      // DATA subrecords (master file sizes) and ONAM (overridden
      // refs) are intentionally not parsed today — they only matter
      // for formID-level conflict detection, which is deferred.
      default:
        break;
    }

    cursor = dataEnd;
  }

  // Scan everything after the TES4 record for top-level groups.
  const topLevelGroups: string[] = [];
  cursor = RECORD_HEADER_SIZE + dataSize;
  while (cursor + RECORD_HEADER_SIZE <= bytes.length) {
    const groupMagic = readAscii(bytes, cursor, 4);
    if (groupMagic !== MAGIC_GRUP) break; // hit a non-group record at top level — stop.

    const groupSize = readUint32LE(bytes, cursor + 4);
    const label = readAscii(bytes, cursor + 8, 4);
    const groupType = readUint32LE(bytes, cursor + 12);

    if (groupType === GROUP_TYPE_TOP) {
      topLevelGroups.push(label);
    }

    if (groupSize < RECORD_HEADER_SIZE) {
      // Malformed — refuse to loop forever on a zero-sized group.
      break;
    }
    cursor += groupSize;
  }

  return {
    magic,
    version,
    declaredRecordCount,
    author,
    description,
    masters,
    topLevelGroups,
    isLight,
    isMaster,
  };
}

// ---------------------------------------------------------------------------
// Low-level readers — no DataView so the parser is bun/node/edge portable.
// ---------------------------------------------------------------------------

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(bytes[offset + i] ?? 0);
  }
  return out;
}

function readCString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  for (let i = offset; i < offset + length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return readAscii(bytes, offset, end - offset);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  // Same byte read as uint32, but cast back to signed via |0.
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  );
}

function readFloat32LE(bytes: Uint8Array, offset: number): number {
  // Stash four bytes into a Float32Array via an ArrayBuffer view.
  // Allocating a fresh buffer per call is fine — TES4 records have
  // exactly one HEDR subrecord, so this fires once per plugin.
  const buf = new ArrayBuffer(4);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) u8[i] = bytes[offset + i] ?? 0;
  return new Float32Array(buf)[0] ?? 0;
}
