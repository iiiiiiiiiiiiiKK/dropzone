import { describe, expect, it } from 'vitest';
import { contiguousOffset, isRetryable, retryDelayMs } from '../src/lib/resume';

const CHUNK = 1024;

describe('contiguousOffset', () => {
  it('returns zero for an empty transfer', () => {
    expect(contiguousOffset([], CHUNK)).toBe(0);
  });

  it('sums a gapless run', () => {
    expect(contiguousOffset([{ seq: 0, byteLength: 1024 }, { seq: 1, byteLength: 1024 }, { seq: 2, byteLength: 512 }], CHUNK)).toBe(2560);
  });

  it('stops at the first gap instead of skipping it', () => {
    expect(contiguousOffset([{ seq: 0, byteLength: 1024 }, { seq: 2, byteLength: 1024 }], CHUNK)).toBe(1024);
  });

  it('ignores out-of-order insertion order', () => {
    expect(contiguousOffset([{ seq: 2, byteLength: 1024 }, { seq: 0, byteLength: 1024 }, { seq: 1, byteLength: 1024 }], CHUNK)).toBe(3072);
  });

  it('refuses to resume without a sane chunk size', () => {
    expect(contiguousOffset([{ seq: 0, byteLength: 10 }], 0)).toBe(0);
    expect(contiguousOffset([{ seq: 0, byteLength: 10 }], Number.NaN)).toBe(0);
  });
});

describe('retryDelayMs', () => {
  it('grows but stays bounded', () => {
    expect(retryDelayMs(1)).toBe(800);
    expect(retryDelayMs(2)).toBe(1600);
    expect(retryDelayMs(3)).toBe(3200);
    expect(retryDelayMs(9)).toBe(6400);
  });
});

describe('isRetryable', () => {
  it('retries transport faults', () => {
    expect(isRetryable('The data channel closed during transfer')).toBe(true);
    expect(isRetryable('Connection timed out')).toBe(true);
    expect(isRetryable('Verification timed out')).toBe(true);
  });

  it('never retries a deliberate stop', () => {
    expect(isRetryable('Canceled')).toBe(false);
    expect(isRetryable('Declined by the other device')).toBe(false);
    expect(isRetryable('Transfer rejected')).toBe(false);
  });
});
