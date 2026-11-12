/**
 * Peer identity policy.
 *
 * A HELLO carries its own public key and a signature over a nonce. That proves the
 * sender holds the matching private key, but on its own it proves nothing about
 * *who* the sender is: a relay could hand over a fresh keypair and the signature
 * would still verify. The identity that matters is the one recorded at pairing time,
 * so the pin is authoritative and a mismatch is a hard failure.
 */
export type TrustDecision = 'verified' | 'mismatch' | 'no-signature';

export function decidePeerTrust(input: {
  /** Public key stored when the device was paired; undefined for a legacy record. */
  pinned?: string;
  /** Public key presented in this HELLO. */
  presented?: string;
  /** Result of verifying the nonce signature with the key actually used. */
  signatureValid: boolean;
}): TrustDecision {
  const { pinned, presented, signatureValid } = input;
  if (!presented) return 'mismatch';
  if (pinned && pinned !== presented) return 'mismatch';
  if (!signatureValid) return 'no-signature';
  return 'verified';
}

/** The key a signature must be checked against: the pin wins over the claim. */
export function keyToVerify(pinned: string | undefined, presented: string): string {
  return pinned ?? presented;
}
