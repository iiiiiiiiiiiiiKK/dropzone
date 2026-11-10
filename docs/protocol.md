# DROPZONE Wire Protocol (v1)

Two protocols live here:

1. **Signaling protocol** — JSON text frames over a single WebSocket (WSS) to the signaling service.
   The signaling service only relays; it never stores file bytes, file names, or file content.
2. **Peer transfer protocol** — length-prefixed control/data frames over an `RTCDataChannel`
   between two paired devices.

Both are versioned. `v` fields are integers; a receiver that sees an unknown `v` must fail closed.

---

## 1. Signaling protocol

Endpoint: `wss://<signal-host>/ws` (Node server also serves `GET /health` and `GET /turn`).

* Frames are JSON. Max frame size **32 KiB** (server closes with 1009 beyond that).
* A client must send `hello` within 10 s or the socket is closed (1008).
* Per-connection rate limit: 60 messages / 10 s window, then close 1008.
* Server keeps connection state in memory only.

### 1.1 Client → Server

| `t` | Payload | Meaning |
| --- | --- | --- |
| `hello` | `{ v:1, device:{ id, name, type, publicKey }, pairToken?: string }` | Register the device on the relay. `publicKey` is base64url SPKI (ECDSA P-256). `pairToken` is the one-time secret from an invitation QR. |
| `presence` | `{ device:{ name, type } }` | Update own display metadata. |
| `invite` | `{ tokenHash: string /* hex sha256 of token */, expiresAt: number }` | Register a single-use pairing invitation owned by this device. |
| `signal` | `{ to: string, data: { kind:'offer'\|'answer'\|'candidate'\|'bye', sdp?, candidate? } }` | Relay SDP/ICE to a paired peer. |
| `ping` | `{}` | Keepalive; server answers `pong`. |

### 1.2 Server → Client

| `t` | Payload | Meaning |
| --- | --- | --- |
| `ready` | `{ self:{id}, ice:{ stun:[], turn:{ urls, username, credential, ttl } \| null }, peers:[Peer], limits:{ maxFrameBytes } }` | Sent after a successful `hello`. `Peer = { id, name, type, publicKey, online, lastSeen }`. |
| `peers` | `{ peers:[Peer] }` | Paired-device roster changed (online/offline/rename). |
| `paired` | `{ peer: Peer }` | Mutual pairing completed; emitted to **both** devices. |
| `signal` | `{ from: string, data: {...} }` | Relayed peer signal. |
| `pong` | `{ ts:number }` | Reply to `ping`. |
| `error` | `{ code: string, message: string }` | Non-fatal (e.g. `pair_unknown`) unless followed by close. |

Pairing errors: `pair_unknown`, `pair_expired`, `pair_used`, `pair_self`, `pair_not_online`, `not_paired`, `peer_offline`, `rate_limited`, `frame_too_large`, `bad_message`.

### 1.3 Pairing flow (one-time, short-lived)

1. Device A generates `token = random 32 bytes (base64url)`, keeps it in memory, and calls
   `invite` with `tokenHash = sha256(token)` and `expiresAt = now + 300 s`.
2. A renders a QR: `https://<app>/#/pair?d=<A.id>&k=<A.publicKey>&t=<token>&n=<A.name>&e=<expiresAt>`.
   The token is short-lived and single-use; it is **not** a private key or long-term secret.
3. Device B scans/opens the QR, generates its own identity, then connects with
   `hello{ pairToken: token }`.
4. Server verifies hash, expiry, single use and that the owner is online, then emits `paired`
   to both sides and consumes the invitation.
5. B stores A's `publicKey` from the QR (trusted by proximity); A stores B's `publicKey`
   from the relay, then B signs the handshake nonce relayed as a `signal{kind:'offer'}`
   payload, and A verifies it against B's key. Both sides display a 5-word/6-digit
   **safety number** = `first 10 hex chars of sha256(sort(A.publicKey, B.publicKey))`
   so a human can confirm the pairing out of band.

### 1.4 TURN credentials

`GET /turn?device=<id>` (Node) or the `ready.ice.turn` field (both servers) returns
short-lived credentials derived with coturn `static-auth-secret`:

```
username  = "<expiry-unix>:<deviceId>"
credential = base64( HMAC-SHA1( TURN_SECRET, username ) )
```

The secret never leaves the server. TTL default 3600 s. When `TURN_SECRET`/`TURN_URLS`
are unset the server returns `null` and the client degrades to STUN-only, saying so in the UI.

---

## 2. Peer transfer protocol (DataChannel)

Ordered, reliable `RTCDataChannel` labelled `dropzone.v1`.

Every frame: `[1 byte type][4 byte big-endian payload length][payload]`.
Control payloads are UTF-8 JSON; data payloads are raw bytes.

| Type | Name | Direction | Payload |
| --- | --- | --- | --- |
| 0x01 | `HELLO` | both | `{ v:1, deviceId, publicKey, nonce, sig }` — identity proof of possession |
| 0x02 | `META` | sender → receiver | `{ transferId, kind:'file'\|'text', name, mime, size, chunkSize, sha256? }` |
| 0x03 | `ACCEPT` | receiver → sender | `{ transferId, offset }` — resume offset (0 = fresh) |
| 0x04 | `REJECT` | receiver → sender | `{ transferId, reason }` |
| 0x05 | `CHUNK` | sender → receiver | header `{ transferId, seq }` + raw bytes |
| 0x06 | `DONE` | sender → receiver | `{ transferId, size, sha256 }` |
| 0x07 | `VERIFY` | receiver → sender | `{ transferId, ok, sha256? }` |
| 0x08 | `CANCEL` | both | `{ transferId, reason }` |
| 0x09 | `TEXT` | both | `{ textId, body, createdAt }` |
| 0x0a | `PING` / `PONG` | both | `{ ts }` |

Rules:

* Chunk size 64 KiB, adapted down to 16 KiB if `bufferedAmount` stays above the 8 MiB high-water mark.
* Sender waits for `bufferedamountlow` (threshold 1 MiB) before pushing more chunks.
* `sha256` is an incremental SHA-256 over the whole payload, computed while streaming.
* The receiver writes chunks into IndexedDB as they arrive and verifies the digest on `DONE`;
  a mismatch triggers `VERIFY{ok:false}` and the sender may retry once automatically.
* Resume (`ACCEPT.offset > 0`) is supported **within a live session**; across a page reload the
  transfer is marked `interrupted` in history and can be restarted, never silently resumed.
