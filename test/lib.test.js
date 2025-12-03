/**
 * Unit tests for lib.js pure functions
 */
import { describe, it, expect } from 'vitest';

// Import lib.js (UMD format exports to `exports` in Node)
const Lib = await import('../public/lib.js');

describe('hexToRGB', () => {
  const { hexToRGB } = Lib;

  it('parses 6-digit hex with hash', () => {
    expect(hexToRGB('#A3BE8C')).toEqual({ r: 163, g: 190, b: 140 });
  });

  it('parses 6-digit hex without hash', () => {
    expect(hexToRGB('A3BE8C')).toEqual({ r: 163, g: 190, b: 140 });
  });

  it('parses lowercase hex', () => {
    expect(hexToRGB('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns black for invalid input', () => {
    expect(hexToRGB('invalid')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRGB('')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('parseRLE', () => {
  const { parseRLE } = Lib;

  it('parses blinker (3o!)', () => {
    const result = parseRLE('3o!');
    expect(result.ok).toBe(true);
    expect(result.coords).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('parses glider (bo$2bo$3o!)', () => {
    const result = parseRLE('bo$2bo$3o!');
    expect(result.ok).toBe(true);
    expect(result.coords).toEqual([
      [1, 0],
      [2, 1],
      [0, 2], [1, 2], [2, 2]
    ]);
  });

  it('parses block (2o$2o!)', () => {
    const result = parseRLE('2o$2o!');
    expect(result.ok).toBe(true);
    expect(result.coords).toEqual([
      [0, 0], [1, 0],
      [0, 1], [1, 1]
    ]);
  });

  it('handles empty pattern', () => {
    const result = parseRLE('!');
    expect(result.ok).toBe(true);
    expect(result.coords).toEqual([]);
  });

  it('handles dead cells (b)', () => {
    const result = parseRLE('bob$obo$bob!');
    expect(result.ok).toBe(true);
    expect(result.coords).toEqual([
      [1, 0],
      [0, 1], [2, 1],
      [1, 2]
    ]);
  });

  it('handles multi-line skips (3$)', () => {
    const result = parseRLE('o3$o!');
    expect(result.ok).toBe(true);
    expect(result.coords).toEqual([
      [0, 0],
      [0, 3]
    ]);
  });

  it('strips header comments', () => {
    const rle = `#C This is a comment
#O Author
x = 3, y = 1, rule = B3/S23
3o!`;
    const result = parseRLE(rle);
    expect(result.ok).toBe(true);
    expect(result.coords).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('handles alternate syntax (* and .)', () => {
    const result = parseRLE('.*.$*.*.$.*.!');
    expect(result.ok).toBe(true);
    expect(result.coords.length).toBe(4);
  });

  it('rejects huge run-length', () => {
    const result = parseRLE('999999o!');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Run length');
  });
});

describe('rleToCoords', () => {
  const { rleToCoords } = Lib;

  it('parses simple patterns', () => {
    expect(rleToCoords('3o!')).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('handles newlines', () => {
    expect(rleToCoords('o$o$o!')).toEqual([[0, 0], [0, 1], [0, 2]]);
  });
});

describe('coordsToRLE', () => {
  const { coordsToRLE, rleToCoords } = Lib;

  it('generates valid RLE for blinker', () => {
    const coords = [[0, 0], [1, 0], [2, 0]];
    const rle = coordsToRLE(coords);
    expect(rle).toContain('3o');
    expect(rle).toContain('!');
  });

  it('roundtrip: coords -> RLE -> coords', () => {
    const original = [[0, 0], [1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
    const rle = coordsToRLE(original);
    const restored = rleToCoords(rle);
    
    // Sort for comparison (order may differ)
    const sortCoords = (c) => [...c].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(sortCoords(restored)).toEqual(sortCoords(original));
  });

  it('handles empty coords', () => {
    expect(coordsToRLE([])).toBe('!');
  });

  it('handles single cell', () => {
    const rle = coordsToRLE([[5, 3]]);
    expect(rle).toContain('o');
    expect(rle).toContain('!');
  });
});

describe('parseRule', () => {
  const { parseRule } = Lib;

  it('parses Conway Life (B3/S23)', () => {
    const rule = parseRule('B3/S23');
    expect(rule).not.toBeNull();
    expect(rule.birth[3]).toBe(true);
    expect(rule.birth[2]).toBe(false);
    expect(rule.survival[2]).toBe(true);
    expect(rule.survival[3]).toBe(true);
    expect(rule.survival[4]).toBe(false);
  });

  it('parses HighLife (B36/S23)', () => {
    const rule = parseRule('B36/S23');
    expect(rule.birth[3]).toBe(true);
    expect(rule.birth[6]).toBe(true);
  });

  it('parses Seeds (B2/S)', () => {
    const rule = parseRule('B2/S');
    expect(rule.birth[2]).toBe(true);
    expect(rule.survival.every(s => !s)).toBe(true);
  });

  it('parses Life without Death (B3/S012345678)', () => {
    const rule = parseRule('B3/S012345678');
    expect(rule.survival.every(s => s)).toBe(true);
  });

  it('handles lowercase', () => {
    const rule = parseRule('b3/s23');
    expect(rule.birth[3]).toBe(true);
  });

  it('returns null for invalid format', () => {
    expect(parseRule('invalid')).toBeNull();
    expect(parseRule('B3S23')).toBeNull(); // missing slash
    expect(parseRule('')).toBeNull();
  });
});

describe('isValidRule', () => {
  const { isValidRule } = Lib;

  it('validates correct rules', () => {
    expect(isValidRule('B3/S23')).toBe(true);
    expect(isValidRule('B/S')).toBe(true);
    expect(isValidRule('B012345678/S012345678')).toBe(true);
  });

  it('rejects invalid rules', () => {
    expect(isValidRule('invalid')).toBe(false);
    expect(isValidRule('B3S23')).toBe(false);
  });
});

describe('normalizeRule', () => {
  const { normalizeRule } = Lib;

  it('normalizes to uppercase', () => {
    expect(normalizeRule('b3/s23')).toBe('B3/S23');
  });

  it('sorts digits', () => {
    expect(normalizeRule('B63/S32')).toBe('B36/S23');
  });

  it('returns null for invalid', () => {
    expect(normalizeRule('invalid')).toBeNull();
  });
});

describe('popcount32', () => {
  const { popcount32 } = Lib;

  it('counts bits correctly', () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(1)).toBe(1);
    expect(popcount32(0b11111111)).toBe(8);
    expect(popcount32(0xFFFFFFFF)).toBe(32);
    expect(popcount32(0b10101010)).toBe(4);
  });

  it('handles edge cases', () => {
    expect(popcount32(0x80000000)).toBe(1); // highest bit
    expect(popcount32(0x7FFFFFFF)).toBe(31);
  });
});
