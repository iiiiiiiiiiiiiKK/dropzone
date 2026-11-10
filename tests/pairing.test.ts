import { describe, expect, it } from 'vitest';
import { createInviteToken, decodeInvite, encodeInvite, hashToken, inviteIsExpired } from '../src/lib/pairing';

const invite = {
  deviceId: 'abc123abc123abc123abc123',
  publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE',
  name: 'MacBook Pro',
  token: 'short-lived-token-value',
  expiresAt: Date.now() + 60_000,
};

describe('pairing invitations', () => {
  it('round trips through the QR payload', () => {
    const encoded = encodeInvite(invite);
    expect(encoded).toMatch(/#\/pair\?/);
    expect(decodeInvite(encoded)).toEqual(invite);
  });

  it('rejects junk and incomplete payloads', () => {
    expect(decodeInvite('')).toBeNull();
    expect(decodeInvite('https://example.com/')).toBeNull();
    expect(decodeInvite('#/pair?d=only-device')).toBeNull();
  });

  it('honours the expiry timestamp', () => {
    expect(inviteIsExpired(invite)).toBe(false);
    expect(inviteIsExpired({ ...invite, expiresAt: Date.now() - 1000 })).toBe(true);
  });

  it('creates unguessable single-use tokens with deterministic hashes', async () => {
    const token = createInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(await hashToken(token)).toBe(await hashToken(token));
    expect(await hashToken(token)).not.toBe(await hashToken(createInviteToken()));
    expect(await hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
