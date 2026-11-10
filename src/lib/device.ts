import { fromBase64Url, randomId, toBase64Url, toHex } from './utils';

export type DeviceType = 'desktop' | 'mobile' | 'tablet';

export type Identity = {
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
};

const ECDSA_PARAMS: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

const encoder = new TextEncoder();

export function detectDeviceType(): DeviceType {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && touch)) return 'tablet';
  if (/Android|iPhone|iPod|Mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function defaultDeviceName(type: DeviceType): string {
  const platform = typeof navigator !== 'undefined' ? navigator.platform || '' : '';
  if (type === 'mobile') return /iPhone/i.test(platform) ? 'iPhone' : 'Phone';
  if (type === 'tablet') return 'Tablet';
  if (/Mac/i.test(platform)) return 'Mac';
  if (/Win/i.test(platform)) return 'Windows PC';
  if (/Linux/i.test(platform)) return 'Linux';
  return 'This device';
}

/**
 * Creates a fresh P-256 identity. The private key is re-imported as NON-extractable,
 * so it can sign but its bytes can never be exported back out of the Web Crypto store.
 */
export async function createIdentity(): Promise<Identity> {
  const keyPair = await crypto.subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify']);
  const publicSpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateKey = await crypto.subtle.importKey('pkcs8', privatePkcs8, ECDSA_PARAMS, false, ['sign']);
  const publicKey = toBase64Url(publicSpki);
  const deviceId = await fingerprintId(publicKey);
  return { deviceId, publicKey, privateKey };
}

export async function fingerprintId(publicKeyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', fromBase64Url(publicKeyB64) as unknown as BufferSource);
  return toHex(new Uint8Array(digest)).slice(0, 24);
}

export async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromBase64Url(publicKeyB64) as unknown as BufferSource, ECDSA_PARAMS, false, ['verify']);
}

export async function sign(identity: Identity, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign(SIGN_PARAMS, identity.privateKey, encoder.encode(payload) as unknown as BufferSource);
  return toBase64Url(signature);
}

export async function verify(publicKeyB64: string, payload: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await importPublicKey(publicKeyB64);
    return await crypto.subtle.verify(SIGN_PARAMS, key, fromBase64Url(signatureB64) as unknown as BufferSource, encoder.encode(payload) as unknown as BufferSource);
  } catch {
    return false;
  }
}

/** Deterministic 12-hex-char fingerprint of the pair, stable regardless of who pairs first. */
export async function safetyNumber(publicKeyA: string, publicKeyB: string): Promise<string> {
  const [first, second] = [publicKeyA, publicKeyB].sort();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${first}|${second}`) as unknown as BufferSource);
  const hex = toHex(new Uint8Array(digest)).slice(0, 12).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function newNonce(): string {
  return randomId(18);
}

export function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined' && typeof crypto.subtle.generateKey === 'function';
}
