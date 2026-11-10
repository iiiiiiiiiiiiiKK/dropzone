import { randomId } from './utils';

export type PairInvite = {
  deviceId: string;
  publicKey: string;
  name: string;
  token: string;
  expiresAt: number;
};

export function createInviteToken(): string {
  return randomId(32);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token) as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function encodeInvite(invite: PairInvite): string {
  const origin = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'https://dropzone.local/';
  const params = new URLSearchParams({
    d: invite.deviceId,
    k: invite.publicKey,
    n: invite.name,
    t: invite.token,
    e: String(invite.expiresAt),
  });
  return `${origin}#/pair?${params.toString()}`;
}

export function decodeInvite(input: string): PairInvite | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hashIndex = trimmed.indexOf('#/pair?');
  const queryIndex = trimmed.indexOf('?');
  const query = hashIndex >= 0 ? trimmed.slice(hashIndex + '#/pair?'.length) : queryIndex >= 0 ? trimmed.slice(queryIndex + 1) : trimmed;
  try {
    const params = new URLSearchParams(query);
    const deviceId = params.get('d');
    const publicKey = params.get('k');
    const name = params.get('n');
    const token = params.get('t');
    const expiresAt = Number(params.get('e'));
    if (!deviceId || !publicKey || !token || !Number.isFinite(expiresAt)) return null;
    return { deviceId, publicKey, name: name ?? 'Unknown device', token, expiresAt };
  } catch {
    return null;
  }
}

export function inviteIsExpired(invite: PairInvite): boolean {
  return Date.now() > invite.expiresAt;
}
