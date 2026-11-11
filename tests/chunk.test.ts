import { describe, expect, it } from 'vitest';
import { computeChunkSize } from '../src/lib/frame';

const PREFERRED = 64 * 1024;
const MINIMUM = 16 * 1024;
const OVERHEAD = 5 + 1 + 24 + 4;

describe('computeChunkSize', () => {
  it('keeps the preferred size when the peer allows it', () => {
    expect(computeChunkSize(256 * 1024, OVERHEAD, PREFERRED, MINIMUM)).toBe(PREFERRED);
  });

  it('leaves room for the frame overhead at the 64 KiB ceiling', () => {
    // 65536 - 34 = 65502 -> floor to a 1 KiB boundary = 64512, frame = 64546.
    const size = computeChunkSize(64 * 1024, OVERHEAD, PREFERRED, MINIMUM);
    expect(size).toBe(64512);
    expect(size + OVERHEAD).toBeLessThanOrEqual(64 * 1024);
  });

  it('shrinks below the preferred size when the peer caps lower', () => {
    // 20480 - 34 = 20446 -> 19456, still above the minimum.
    expect(computeChunkSize(20 * 1024, OVERHEAD, PREFERRED, MINIMUM)).toBe(19456);
  });

  it('never returns less than the minimum', () => {
    expect(computeChunkSize(OVERHEAD + 10, OVERHEAD, PREFERRED, MINIMUM)).toBe(MINIMUM);
    expect(computeChunkSize(OVERHEAD, OVERHEAD, PREFERRED, MINIMUM)).toBe(MINIMUM);
  });

  it('falls back to 64 KiB when the peer declares nothing', () => {
    expect(computeChunkSize(0, OVERHEAD, PREFERRED, MINIMUM)).toBe(64512);
    expect(computeChunkSize(Number.NaN, OVERHEAD, PREFERRED, MINIMUM)).toBe(64512);
  });

  it('aligns to whole KiB', () => {
    for (const max of [64 * 1024, 96 * 1024, 128 * 1024, 256 * 1024]) {
      expect(computeChunkSize(max, OVERHEAD, PREFERRED, MINIMUM) % 1024).toBe(0);
    }
  });
});
