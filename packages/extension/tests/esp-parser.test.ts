/**
 * ESP binary parser tests.
 *
 * Every fixture ESP is constructed in-test from a small builder so
 * the assertions stay anchored to a visible byte layout. We never
 * read fixture files from disk — keeping synthesised plugins in
 * code avoids checking opaque binaries into the repo and makes the
 * intended shape of each test obvious.
 *
 * Format reference: UESP wiki "Tes4Mod:File Format". The TES4 header
 * is 24 bytes followed by ``dataSize`` bytes of 6-byte-headered
 * subrecords, then any number of top-level GRUP records.
 */

import { describe, expect, test } from 'bun:test';
import { parseEspHeader, EspParseError } from '../src/conflict/index.js';

// ---------------------------------------------------------------------------
// Binary builders
// ---------------------------------------------------------------------------

class BytesBuilder {
  private chunks: number[] = [];

  ascii(s: string): this {
    for (const ch of s) this.chunks.push(ch.charCodeAt(0) & 0xff);
    return this;
  }

  uint16LE(n: number): this {
    this.chunks.push(n & 0xff, (n >>> 8) & 0xff);
    return this;
  }

  uint32LE(n: number): this {
    this.chunks.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    return this;
  }

  float32LE(n: number): this {
    const buf = new ArrayBuffer(4);
    new Float32Array(buf)[0] = n;
    for (const b of new Uint8Array(buf)) this.chunks.push(b);
    return this;
  }

  cstring(s: string): this {
    this.ascii(s);
    this.chunks.push(0);
    return this;
  }

  raw(bytes: number[] | Uint8Array): this {
    for (const b of bytes) this.chunks.push(b);
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

interface MakeTes4Options {
  flags?: number;
  version?: number;
  numRecords?: number;
  author?: string;
  description?: string;
  masters?: string[];
}

function makeSubrecord(type: string, data: Uint8Array | number[]): Uint8Array {
  const data8 = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const out = new BytesBuilder();
  out.ascii(type).uint16LE(data8.length).raw(data8);
  return out.build();
}

function makeHedrData(version: number, numRecords: number): Uint8Array {
  return new BytesBuilder().float32LE(version).uint32LE(numRecords).uint32LE(0).build();
}

function makeCStringData(s: string): Uint8Array {
  return new BytesBuilder().cstring(s).build();
}

function makeTes4(opts: MakeTes4Options = {}): Uint8Array {
  const subs: Uint8Array[] = [];
  subs.push(
    makeSubrecord('HEDR', makeHedrData(opts.version ?? 1.0, opts.numRecords ?? 0))
  );
  for (const master of opts.masters ?? []) {
    subs.push(makeSubrecord('MAST', makeCStringData(master)));
    // The real format also writes a DATA subrecord (uint64 master size)
    // after each MAST. Our parser ignores DATA, so we skip emitting it.
  }
  if (opts.author) {
    subs.push(makeSubrecord('CNAM', makeCStringData(opts.author)));
  }
  if (opts.description) {
    subs.push(makeSubrecord('SNAM', makeCStringData(opts.description)));
  }

  const subBytes = concat(subs);

  const header = new BytesBuilder()
    .ascii('TES4')
    .uint32LE(subBytes.length)
    .uint32LE(opts.flags ?? 0)
    .uint32LE(0) // formId
    .uint32LE(0) // versionControlInfo
    .uint16LE(0) // internalVersion
    .uint16LE(0) // unknown
    .build();

  return concat([header, subBytes]);
}

function makeTopLevelGroup(recordType: string, childBytes: Uint8Array = new Uint8Array()): Uint8Array {
  const totalSize = 24 + childBytes.length;
  const header = new BytesBuilder()
    .ascii('GRUP')
    .uint32LE(totalSize)
    .ascii(recordType)
    .uint32LE(0) // groupType 0 = top-level
    .uint32LE(0) // timestamp/unknown
    .uint32LE(0) // unknown
    .build();
  return concat([header, childBytes]);
}

function concat(arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const a of arrs) {
    out.set(a, cursor);
    cursor += a.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseEspHeader', () => {
  test('parses a minimal TES4 with HEDR + masters + author', () => {
    const bytes = makeTes4({
      version: 1.0,
      numRecords: 42,
      author: 'tester',
      masters: ['Fallout4.esm', 'DLCRobot.esm'],
    });
    const header = parseEspHeader(bytes);
    expect(header.magic).toBe('TES4');
    expect(header.version).toBeCloseTo(1.0);
    expect(header.declaredRecordCount).toBe(42);
    expect(header.author).toBe('tester');
    expect(header.masters).toEqual(['Fallout4.esm', 'DLCRobot.esm']);
    expect(header.isMaster).toBe(false);
    expect(header.isLight).toBe(false);
  });

  test('flags isMaster + isLight from the TES4 flag bits', () => {
    const masterEsm = parseEspHeader(makeTes4({ flags: 0x00000001 }));
    expect(masterEsm.isMaster).toBe(true);
    expect(masterEsm.isLight).toBe(false);

    const lightEsl = parseEspHeader(makeTes4({ flags: 0x00000200 }));
    expect(lightEsl.isMaster).toBe(false);
    expect(lightEsl.isLight).toBe(true);
  });

  test('extracts top-level GRUP labels in order', () => {
    const tes4 = makeTes4();
    const groups = concat([
      makeTopLevelGroup('CELL'),
      makeTopLevelGroup('NPC_'),
      makeTopLevelGroup('ARMO'),
    ]);
    const bytes = concat([tes4, groups]);
    const header = parseEspHeader(bytes);
    expect(header.topLevelGroups).toEqual(['CELL', 'NPC_', 'ARMO']);
  });

  test('returns empty topLevelGroups when no groups follow the TES4 record', () => {
    const header = parseEspHeader(makeTes4());
    expect(header.topLevelGroups).toEqual([]);
  });

  test('throws EspParseError on a buffer too short to contain a record header', () => {
    expect(() => parseEspHeader(new Uint8Array(10))).toThrow(EspParseError);
  });

  test('throws EspParseError on a non-TES4 magic', () => {
    const bytes = new BytesBuilder()
      .ascii('FAKE')
      .uint32LE(0)
      .uint32LE(0)
      .uint32LE(0)
      .uint32LE(0)
      .uint16LE(0)
      .uint16LE(0)
      .build();
    expect(() => parseEspHeader(bytes)).toThrow(EspParseError);
  });

  test('stops the top-level scan at a non-GRUP record without throwing', () => {
    const tes4 = makeTes4();
    // A spurious non-group block after TES4 (e.g. a stray top-level
    // record). The parser should stop scanning rather than loop.
    const trailing = new BytesBuilder()
      .ascii('CELL') // not GRUP
      .uint32LE(24)
      .uint32LE(0)
      .uint32LE(0)
      .uint32LE(0)
      .uint32LE(0)
      .uint16LE(0)
      .uint16LE(0)
      .build();
    const header = parseEspHeader(concat([tes4, trailing]));
    expect(header.topLevelGroups).toEqual([]);
  });

  test('handles a malformed zero-sized group without looping forever', () => {
    const tes4 = makeTes4();
    const zeroGroup = new BytesBuilder()
      .ascii('GRUP')
      .uint32LE(0) // claimed total size 0 — would loop forever if not guarded
      .ascii('CELL')
      .uint32LE(0)
      .uint32LE(0)
      .uint32LE(0)
      .build();
    const header = parseEspHeader(concat([tes4, zeroGroup]));
    // We are content to either capture or skip the malformed group, but
    // the function must return — failing this test would hang the suite.
    expect(Array.isArray(header.topLevelGroups)).toBe(true);
  });
});
