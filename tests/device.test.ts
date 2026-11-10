import { describe, expect, it } from 'vitest';
import { createIdentity, fingerprintId, safetyNumber, sign, verify } from '../src/lib/device';

describe('device identity', () => {
  it('uses P-256 and derives a stable id from the public key', async () => {
    const identity = await createIdentity();
    expect(identity.deviceId).toHaveLength(24);
    expect(identity.deviceId).toBe(await fingerprintId(identity.publicKey));
    expect(identity.privateKey.extractable).toBe(false);
    expect(identity.privateKey.algorithm.name).toBe('ECDSA');
  });

  it('verifies signatures only for the matching key and payload', async () => {
    const alice = await createIdentity();
    const mallory = await createIdentity();
    const payload = 'deviceA|nonce-123';
    const signature = await sign(alice, payload);

    expect(await verify(alice.publicKey, payload, signature)).toBe(true);
    expect(await verify(alice.publicKey, 'deviceA|nonce-124', signature)).toBe(false);
    expect(await verify(mallory.publicKey, payload, signature)).toBe(false);
    expect(await verify('not-a-key', payload, signature)).toBe(false);
  });

  it('derives a symmetric safety number', async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const forward = await safetyNumber(a.publicKey, b.publicKey);
    expect(forward).toBe(await safetyNumber(b.publicKey, a.publicKey));
    expect(forward).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(forward).not.toBe(await safetyNumber(a.publicKey, a.publicKey));
  });
});
