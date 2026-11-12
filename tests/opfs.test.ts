import { describe, expect, it } from 'vitest';
import { OPFS_MIN_SIZE, sourceFileName } from '../src/lib/opfs';

describe('sourceFileName', () => {
  it('keeps base64url ids intact and appends a suffix', () => {
    expect(sourceFileName('AbC-12_3')).toBe('AbC-12_3.bin');
  });

  it('neutralises characters that are illegal in a path', () => {
    expect(sourceFileName('../etc/passwd')).toBe('___etc_passwd.bin');
    expect(sourceFileName('a/b\\c')).toBe('a_b_c.bin');
  });
});

describe('OPFS_MIN_SIZE', () => {
  it('stays small enough that typical screenshots keep a resumable source', () => {
    // Screenshots and short clips are the common retry case, so the copy threshold
    // must sit below them rather than at a megabyte.
    expect(OPFS_MIN_SIZE).toBeLessThanOrEqual(512 * 1024);
    expect(OPFS_MIN_SIZE).toBeGreaterThan(0);
  });
});
