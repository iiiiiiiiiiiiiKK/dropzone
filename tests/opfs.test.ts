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
  it('only copies files where a local copy pays off', () => {
    expect(OPFS_MIN_SIZE).toBeGreaterThanOrEqual(512 * 1024);
  });
});
