# Security Policy

DROPZONE moves files between your own devices over an encrypted peer-to-peer channel. This document describes what the design protects, what it does not, and how to report a problem privately.

- [Threat model](#threat-model)
- [What the signaling service sees](#what-the-signaling-service-sees)
- [Key handling rules](#key-handling-rules)
- [TURN secret handling](#turn-secret-handling)
- [Self-hosting hardening](#self-hosting-hardening)
- [Reporting a vulnerability](#reporting-a-vulnerability)
- [Supported versions](#supported-versions)

## Threat model

**In scope — the design is meant to defend against these**

| Threat | Mitigation |
| --- | --- |
| A relay operator reading file content | File bytes never leave the two browsers. The relay accepts small JSON control frames only; there is no upload route in the project. |
| Passive network observers on the transfer path | Every DataChannel is DTLS-encrypted end to end. A TURN relay forwards ciphertext; it cannot decrypt. |
| Network observers on the signaling path | Production signaling is `wss://`. Envelopes are small JSON; no file metadata is present. |
| A server impersonating a peer during pairing | The pairing handshake requires an ECDSA P-256 signature over a nonce, verified against the peer's public key; both sides display a safety number derived from both keys so a human can compare out of band. |
| A stolen device key being reused elsewhere | The private key is re-imported as **non-extractable**; it can sign inside Web Crypto but cannot be exported by script. |
| Replay of a pairing invitation | Invitations are single-use, hashed at rest in the relay, short-lived (`PAIRING_TTL_SECONDS`, default 300 s), and consumed on first successful use. |

**Out of scope — the design does not defend against these**

- A compromised endpoint: malware on either device, a malicious browser extension, or a hostile OS can read whatever the page can read, including IndexedDB.
- A malicious signaling relay performing a full man-in-the-middle *during the first pairing*. Whoever scans the QR trusts the key printed there, so a relay that rewrites both sides at that moment can still cause a wrong pairing; the safety number is the defence, and only if a human compares it. After pairing, the stored key pins the peer and a substitution is reported as a mismatch.
- Denial of service against your own relay or TURN server.
- Traffic analysis: the relay observes connection timing, message sizes and online presence.
- Physical access to an unlocked device.
- Anything you do with a file after downloading it — downloaded content is active content at its origin.

## What the signaling service sees

The relay is a rendezvous point. Per connection it can observe:

| Observed | Not observed |
| --- | --- |
| Device id (a 24-hex fingerprint of the public key), display name, device type | File content, in any form |
| Public key (base64url SPKI, ECDSA P-256) | Private keys |
| Presence transitions (online / offline / last seen) | File names, MIME types, file sizes |
| Pairing invitation hashes and expiry times | Text notes and clipboard contents |
| Relayed SDP and ICE payloads (candidate addresses, fingerprints) | Passwords or account identifiers — there are no accounts |
| Message sizes, timings, connection counts, origin of the WebSocket upgrade | Turn credentials *after* they are minted and delivered |

Operationally: state is in memory only; restarting the process clears the roster, pair links and pending invitations. Logs are bounded and must never contain file data or tokens. `GET /health` exposes aggregate counts, not device identities.

## Key handling rules

1. **Generation.** Each browser generates an ECDSA P-256 keypair with Web Crypto on first run. The device id is the first 24 hex characters of `SHA-256(SPKI public key)`.
2. **Storage.** The wrapped key material and device id live in browser-local storage for that origin. Clearing site data destroys the identity; the device must be re-paired afterwards.
3. **Non-extractable private key.** The PKCS#8 export is used once to re-import the key as non-extractable. No code path exports it again, and no code path logs it.
4. **Signing only.** The private key signs handshake nonces. It never encrypts file data — DTLS does that.
5. **Verification.** Public keys received from a relay are untrusted until the handshake signature verifies *and* the safety number matches what the other screen shows.
6. **No key escrow.** There is no recovery, no backup, no server-side copy. Losing browser storage means losing the identity and re-pairing.
7. **Revocation is local.** Unpairing a device removes it from your local roster. There is no global revocation list; a device that still holds your public key can still attempt a connection, which you must reject.

## TURN secret handling

- `TURN_SECRET` is the coturn `static-auth-secret`. It stays on the server that mints credentials and is never sent to a browser.
- Credentials are minted per request as `username = "<expiry-unix>:<deviceId>"` and `credential = base64(HMAC-SHA1(TURN_SECRET, username))`, with `TURN_TTL_SECONDS` (default 3600, clamped 60–86400).
- `GET /turn` returns `null` when `TURN_URLS` or `TURN_SECRET` is unset; clients then fall back to STUN-only and the UI says so instead of pretending a relay path exists.
- Rotate the secret by restarting coturn and the relay with a new value; outstanding credentials simply expire.
- Never expose `/turn` without an origin check, rate limiting and TLS in front of it.
- Do not reuse a TURN secret across environments. A leaked secret lets anyone mint credentials and relay traffic through your server.

## Self-hosting hardening

- Put the relay behind a TLS-terminating reverse proxy; only `wss://` on a public port.
- Set `ALLOWED_ORIGINS` to your exact frontend origin. The default (empty) accepts any origin — convenient for local development, wrong for production.
- Keep `MAX_CLIENTS` and `MAX_SIGNAL_BYTES` bounded, and `HELLO_TIMEOUT_MS` short, so idle or oversized sockets cannot accumulate.
- Rate limiting is per connection (60 messages / 10 s window). Add proxy-level limits for unauthenticated floods.
- Keep `LOG_LEVEL` at `info` in production; `debug` is for development only.
- Serve the SPA with a Content-Security-Policy that allows only your own origin, the font/CDN hosts you actually use, and `connect-src` for your `wss://` endpoint.
- The relay keeps state in memory and is not horizontally scalable without a shared store. Do not advertise it as more than a reference implementation.
- Patch Node, Wrangler, coturn and your reverse proxy; this repository does not manage that lifecycle for you.

## Reporting a vulnerability

Please report privately. Do **not** open a public issue for an exploitable problem.

- Contact: <https://x.com/0xkillcoin> (direct message)
- Include: affected component (web app, signaling relay, Worker variant, docs), version or commit, reproduction steps, and the impact you believe it has.
- Expect an acknowledgement as soon as practical, an assessment, and a coordinated disclosure window. Credit is offered unless you prefer otherwise.
- Please do not test against infrastructure you do not own, do not run load tests against the public demo, and do not attempt to access other users' data.

## Supported versions

| Version | Supported | Notes |
| --- | --- | --- |
| 1.x (`main`) | ✅ | Security fixes land here first. |
| Pre-1.0 snapshots | ❌ | Protocol v1 is the only supported wire format; older snapshots are unsupported. |

Only the static SPA and the two signaling implementations (`server/`, `workers/signaling/`) are in scope. Third-party deployments — your own relay, your own coturn, your static host — are operated by whoever deploys them.