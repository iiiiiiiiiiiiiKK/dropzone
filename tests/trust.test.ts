import { describe, expect, it } from 'vitest';
import { decidePeerTrust, keyToVerify } from '../src/lib/trust';

const PINNED = 'pinned-key-A';
const OTHER = 'attacker-key-B';

describe('decidePeerTrust', () => {
  it('accepts a matching key with a valid signature', () => {
    expect(decidePeerTrust({ pinned: PINNED, presented: PINNED, signatureValid: true })).toBe('verified');
  });

  it('rejects a substituted key even when its signature is valid', () => {
    // This is the relay-substitution case: the signature checks out for the key
    // that was presented, but that key is not the one the user paired with.
    expect(decidePeerTrust({ pinned: PINNED, presented: OTHER, signatureValid: true })).toBe('mismatch');
  });

  it('rejects a bad signature on the pinned key', () => {
    expect(decidePeerTrust({ pinned: PINNED, presented: PINNED, signatureValid: false })).toBe('no-signature');
  });

  it('rejects a HELLO that presents no key', () => {
    expect(decidePeerTrust({ pinned: PINNED, presented: undefined, signatureValid: true })).toBe('mismatch');
  });

  it('still verifies legacy records that have no stored pin', () => {
    expect(decidePeerTrust({ pinned: undefined, presented: OTHER, signatureValid: true })).toBe('verified');
    expect(decidePeerTrust({ pinned: undefined, presented: OTHER, signatureValid: false })).toBe('no-signature');
  });
});

describe('keyToVerify', () => {
  it('prefers the pinned key over the presented one', () => {
    expect(keyToVerify(PINNED, OTHER)).toBe(PINNED);
  });

  it('falls back to the presented key when nothing is pinned', () => {
    expect(keyToVerify(undefined, OTHER)).toBe(OTHER);
  });
});
