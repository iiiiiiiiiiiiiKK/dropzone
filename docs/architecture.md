# DROPZONE architecture

This document describes how the repository is organised, how state is modelled, and how a transfer actually runs. It assumes the wire format in [protocol.md](protocol.md); if the two ever disagree, the code and the protocol document win.

- [Runtime topology](#runtime-topology)
- [Module map](#module-map)
- [Configuration resolution](#configuration-resolution)
- [Data model](#data-model)
- [Transfer state machine](#transfer-state-machine)
- [Sequence: pairing a new device](#sequence-pairing-a-new-device)
- [Sequence: sending a file](#sequence-sending-a-file)
- [Transfer tuning constants](#transfer-tuning-constants)
- [Signaling client behaviour](#signaling-client-behaviour)
- [Peer connection and ICE](#peer-connection-and-ice)
- [Storage lifecycle](#storage-lifecycle)
- [PWA shell](#pwa-shell)
- [Where to change what](#where-to-change-what)

## Runtime topology

Three processes, one of which is optional:

```text
┌──────────────────┐        ┌──────────────────┐
│  static SPA      │        │  static SPA      │
│  (device A)      │        │  (device B)      │
└────────┬─────────┘        └────────┬─────────┘
         │  wss:// (JSON only)       │
         └────────────┬──────────────┘
                      ▼
          ┌───────────────────────┐        ┌──────────────────┐
          │ signaling relay       │───────▶│ coturn           │
          │ server/ · workers/    │ mints  │ HMAC REST creds  │
          └───────────────────────┘        └──────────────────┘
                      ▲                             ▲
                      │  SDP / ICE / roster         │ relayed DTLS
                      └─────────────┬───────────────┘
                                    │
                     RTCDataChannel │ dropzone.v1 (direct or TURN)
                                    ▼
                        file bytes: A ⇄ B only
```

| Component | Lives in | Trust |
| --- | --- | --- |
| Static SPA | `src/`, built by Vite to `dist/` | Holds identity, history and file bytes. |
| Relay (Node) | `server/index.mjs` | Trusted for discovery and SDP/ICE relay; sees no file data. In-memory state only. |
| Relay (edge) | `workers/signaling/` | Same protocol on a Cloudflare Worker + Durable Object. |
| TURN | external coturn | Relays ciphertext when ICE cannot connect directly. Short-lived HMAC credentials per device. |

## Module map

### Application shell

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | React root, theme class on `<html>`, service-worker registration. |
| `src/App.tsx` | Shell layout (sidebar, topbar, device rail, mobile bottom nav), hash-based view routing, global providers. |
| `src/styles.css` | Tailwind v4 entry plus design tokens. Dark is the default theme; `.light` overrides the token values. |

### Domain logic (`src/lib/`)

| Path | Responsibility |
| --- | --- |
| `utils.ts` | `cn()`, `formatBytes`, relative time, file-kind detection, id helpers, download helpers. |
| `constants.ts` | Storage keys, protocol/chunking constants, `resolveConfig()` for the signaling and STUN endpoints. |
| `device.ts` | ECDSA P-256 identity generation and persistence, `sign`/`verify`, nonce creation, safety number. |
| `db.ts` | Dexie schema and every query/mutation over `devices`, `transfers`, `files`, `chunks`, `texts`, `settings`; storage estimate, export, pruning. |
| `signaling.ts` | WebSocket relay client: `hello`/`presence`/`invite`/`signal`, heartbeat, backoff reconnect, roster updates. |
| `peer.ts` | One `RTCPeerConnection` per paired device: ICE configuration (STUN + short-lived TURN), DataChannel lifecycle, connection-type reporting via `getStats()`. |
| `transfer.ts` | Framing, SCTP-safe chunking, `bufferedAmount` backpressure, incremental SHA-256, resume across sessions and reloads, cancel and retry. |
| `clipboard.ts` | Paste, drag-and-drop and file-picker ingestion; object-URL previews and revocation. |
| `pairing.ts` | Invitation token creation, QR payload encode/decode, expiry checks. |
| `trust.ts` | Peer identity policy: pin the paired public key, judge a HELLO against it. |
| `opfs.ts` | Durable source copies so an interrupted outgoing transfer can resume after a reload. |
| `resume.ts` | Contiguous-chunk arithmetic, retry backoff, retryable-error classification, boot reconciliation. |
| `theme.ts` | Theme persistence with system fallback, applied as a class on the document element. |

### UI (`src/components/`, `src/views/`)

| Path | Responsibility |
| --- | --- |
| `components/ui.tsx` | Primitives: Button, Card, IconButton, Switch, Dialog, Toast, Progress, Tooltip, EmptyState. |
| `components/Logo.tsx` | Wordmark and mark. |
| `components/TopBar.tsx` | Device pill, relay status, online count, X author link, theme toggle. |
| `components/Sidebar.tsx` | Desktop navigation plus the connection card. |
| `components/MobileNav.tsx` | Bottom tab bar with safe-area insets. |
| `components/DropZone.tsx` | Drag/drop and paste target with a preview queue. |
| `components/DeviceRail.tsx` | Paired devices with presence and quick send. |
| `components/TransferRow.tsx` | History row: icon, name, size, direction, status, actions. |
| `components/PairingDialog.tsx` | QR display, camera scan, token paste, safety-number confirmation. |
| `components/TextComposer.tsx` | Text and clipboard panel. |
| `components/Toasts.tsx` | Toast host (Framer Motion). |
| `views/Workspace.tsx` | Desktop/mobile transfer workspace. |
| `views/History.tsx` | Transfers and favorites. |
| `views/Devices.tsx` | Device management. |
| `views/Settings.tsx` | Theme, device name, retention, storage usage, export/clear, notifications, relay URL. |

## Configuration resolution

`resolveConfig()` in `src/lib/constants.ts` picks the signaling endpoint in this order:

1. `window.__DROPZONE_CONFIG__.signalUrl` from an optional `config.js` served next to `index.html`.
2. `import.meta.env.VITE_SIGNAL_URL` baked in at build time.
3. Same-origin `ws(s)://<current-host>/ws`, which keeps single-host self-hosting simple.

STUN follows the same shape (`window.__DROPZONE_CONFIG__.stunUrls` → `VITE_STUN_URLS` → built-in list). A per-device override typed into Settings wins for that device only and is stored locally.

## Data model

Everything persistent lives in IndexedDB through Dexie, database name `dropzone`, schema version 1. No table leaves the browser.

### `devices` — paired peers

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `string` (PK) | First 24 hex chars of `SHA-256(SPKI public key)`. |
| `name` | `string` | Display name at pairing time, renameable locally. |
| `type` | `string` | `desktop` \| `mobile` \| `tablet`. |
| `publicKey` | `string` | base64url SPKI, ECDSA P-256. |
| `pairedAt` | `number` | Epoch ms. |
| `lastSeen` | `number` | Epoch ms, updated from presence events. |
| `online` | `boolean?` | Live presence hint; not persisted truth. |
| `safetyNumber` | `string?` | `XXXX-XXXX-XXXX` shown at pairing time. |

Indexes: `&id, name, pairedAt, lastSeen`.

### `transfers` — history rows

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `string` (PK) | Transfer id from `META`. |
| `kind` | `'file' \| 'text'` | |
| `name` | `string` | File name or text label. |
| `mime` | `string` | |
| `size` | `number` | Bytes. |
| `direction` | `'in' \| 'out'` | |
| `deviceId` / `deviceName` | `string` | Peer snapshot, so history survives unpairing. |
| `createdAt` / `completedAt` | `number` | Epoch ms. |
| `status` | `TransferStatus` | See the state machine below. |
| `sha256` | `string?` | Digest agreed on `DONE`/`VERIFY`. |
| `favorite` | `number` | `1` or `0`. |
| `error` | `string?` | Failure detail for the UI. |
| `thumbnail` | `Blob?` | Small preview for images. |

Indexes: `&id, createdAt, status, direction, deviceId, favorite`. History is ordered by `createdAt` descending; `pruneHistory()` keeps favorites and trims the rest to the configured limit.

### `files` — completed payloads

| Column | Type | Notes |
| --- | --- | --- |
| `transferId` | `string` (PK) | 1:1 with a `transfers` row. |
| `blob` | `Blob?` | Assembled file. |
| `size` | `number` | Bytes. |
| `createdAt` | `number` | Epoch ms. |

Index: `&transferId, createdAt`.

### `chunks` — in-flight payload fragments

| Column | Type | Notes |
| --- | --- | --- |
| `transferId` | `string` | Composite key part. |
| `seq` | `number` | Composite key part; monotonic chunk index. |
| `data` | `ArrayBuffer` | One 64 KiB (or 16 KiB) slice. |

Index: `&[transferId+seq], transferId`. Chunk rows are deleted on completion, cancellation or unpairing; they are the basis of in-session resume.

### `texts` — notes and snippets

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `string` (PK) | |
| `content` | `string` | Plain text body. |
| `direction` | `'in' \| 'out'` | |
| `deviceId` / `deviceName` | `string` | Peer snapshot. |
| `createdAt` | `number` | Epoch ms. |
| `favorite` | `number` | `1` or `0`. |

Index: `&id, createdAt, direction, favorite`.

### `settings` — key/value

| Column | Type | Notes |
| --- | --- | --- |
| `key` | `string` (PK) | `app` holds the `AppSettings` object. |
| `value` | `unknown` | JSON-serialisable value. |

`AppSettings` = `deviceName`, `deviceType`, `theme` (`dark` \| `light`), `language` (`en` \| `zh`), `autoReceive`, `notifications`, `historyLimit`, `signalUrlOverride`. Defaults come from `constants.ts`; stored values are shallow-merged over them.

## Transfer state machine

```text
                    ┌─────────┐
                    │ queued  │
                    └────┬────┘
                         │ send META / accept
                         ▼
                 ┌───────────────┐   REJECT   ┌──────────┐
                 │  connecting   │───────────▶│ rejected │
                 └───────┬───────┘            └──────────┘
                         │ ACCEPT { offset }
                         ▼
                 ┌───────────────┐  CANCEL / session end
                 │ transferring  │───────────▶ cancelled / interrupted
                 └───────┬───────┘
                         │ DONE
                         ▼
                 ┌───────────────┐   digest mismatch (after 1 retry)
                 │  verifying    │───────────▶ failed
                 └───────┬───────┘
                         │ VERIFY { ok: true }
                         ▼
                 ┌───────────────┐
                 │   completed   │
                 └───────────────┘
```

| Status | Meaning | Terminal |
| --- | --- | --- |
| `queued` | Entry exists locally, nothing sent yet. | no |
| `connecting` | `META` sent, waiting for `ACCEPT`/`REJECT`. | no |
| `transferring` | Chunks flowing (or waiting on `bufferedamountlow`). | no |
| `verifying` | `DONE` exchanged, digest comparison in progress. | no |
| `completed` | `VERIFY { ok: true }`, payload persisted. | yes |
| `failed` | Transport error, digest mismatch after one retry, or timeout. | yes |
| `rejected` | Receiver answered `REJECT`. | yes |
| `canceled` | Either side sent `CANCEL`. | yes |
| `interrupted` | Page reloaded or session ended mid-transfer. Bytes are retained and the transfer resumes automatically on the next reconnect. | no |

## Sequence: pairing a new device

```text
 Device A                                Relay                                  Device B
 │                                      │                                    │
 1. A generates a 32-byte single-use token and keeps it in memory.
 │ invite { tokenHash, expiresAt } ──▶  │                                    │
 │                                      │ store hash → { owner, expiresAt }  │
 2. A renders the invitation as a QR payload:
    #/pair?d=<deviceId>&k=<pubkey>&n=<name>&t=<token>&e=<exp>
 │                                      │ ◀── hello { pairToken }            │
 │                                      │ check hash · expiry · single use   │
 │                                      │ owner online → consume invite      │
 3. Relay emits `paired` to both devices; each side stores the other's public key.
 │ signal { offer, sig } ──▶            │                                    │
 │                                      │ relay envelope only                │
 │                                      │ ──▶ signal { offer, sig }          │
 4. A verifies B's ECDSA P-256 signature over the nonce against B's public key.
 5. Both show safetyNumber = first 12 hex of SHA-256(sorted(pubA, pubB))
    formatted XXXX-XXXX-XXXX, compared by the two humans out of band.
```

Notes:

- The token is the only short-lived secret and it is stored **hashed** on the relay. A QR screenshot is useless after first use or after `PAIRING_TTL_SECONDS`.
- The relay learns the public keys. B trusts A's key because it arrived over the QR (proximity); A trusts B's key because B signed the nonce with it. The safety number exists so a human can detect relay substitution.
- Pair links survive disconnects in relay memory, but not a relay restart.

## Sequence: sending a file

```text
 Sender (A)                                  Receiver (B)
 │                                        │
 │ ── HELLO (signed) ──────────▶          │   verify identity proof
 │ ── META {name,size,mime} ──▶           │   row: connecting
 │ ◀── ACCEPT { offset } ───────          │   0 fresh · n resume
 │ ── CHUNK seq=0..n ─────────▶           │   persist chunk rows
 │    (64 KiB each) ───────────▶          │   progress + toast
 │    hold at bufferedAmount              │
 │    ≤ 8 MiB, resume at 1 MiB            │
 │ ── DONE { size, sha256 } ──▶           │   assemble + compare
 │ ◀── VERIFY { ok } ───────────          │   completed / failed
```

Resume detail: `ACCEPT.offset` is the byte offset covered by the contiguous prefix of persisted chunks.
The sender seeks to `floor(offset / chunkSize) * chunkSize` and continues on the same grid.

Across a reload, two independent paths converge on the same transfer id:

1. **Sender reloads.** Boot marks in-flight rows `interrupted`; once the relay roster shows the peer
   online, the client opens a channel and calls `resumeOutgoing()`, which streams the OPFS copy.
2. **Receiver reloads.** The receiver keeps its chunks and, on reconnect, sends `RESUME` for each
   `interrupted` inbound transfer; the sender answers by reopening the same transfer.

Both paths are single-flight: `PeerMesh.ensure()` shares one handshake per peer and every resume
claims its transfer id before the first `await`, so overlapping triggers cannot start two senders.

## Transfer tuning constants

| Constant | Value | Used by |
| --- | --- | --- |
| `CHUNK_SIZE` | 64 KiB | `transfer.ts` upper bound |
| `MIN_CHUNK_SIZE` | 16 KiB | `transfer.ts` lower bound |
| `BUFFERED_LOW_THRESHOLD` | 1 MiB | `bufferedamountlow` resume point (also the poll target) |
| `DRAIN_TIMEOUT_MS` | 8 s | Hard cap on one backpressure wait |
| `MAX_SIGNAL_FRAME` | 32 KiB | Client frame guard; relay enforces the same ceiling |
| `PAIRING_TTL_MS` | 5 minutes | Invitation lifetime (relay default `PAIRING_TTL_SECONDS=300`) |
| `DEFAULT_HISTORY_LIMIT` | 100 | History pruning when the user has not chosen a limit |

## Signaling client behaviour

| Concern | Behaviour |
| --- | --- |
| Registration | `hello` with device metadata and optional `pairToken`; the socket is dropped if it never sends one in time. |
| Presence | `presence` on rename or device-type change; the relay broadcasts a fresh `peers` roster. |
| Heartbeat | Periodic `ping` / `pong` keeps intermediaries from idling the socket out. |
| Reconnect | Exponential backoff with jitter, capped; the roster is re-requested after `ready`. |
| Fail-closed | Unknown `v`, unknown frame `t`, or oversized frames are rejected rather than guessed at. |

## Peer connection and ICE

- One `RTCPeerConnection` per paired device, created lazily when a transfer starts and reused while alive.
- ICE servers come from the relay's `ready` payload: STUN always, TURN only when the operator configured it (credentials minted per device, short TTL).
- The DataChannel is ordered and reliable, label `dropzone.v1`.
- Connection type is reported from `getStats()` (host/srflx/prflx vs relay) so the UI can say whether traffic is direct or relayed.
- Teardown clears timers, closes the channel and the peer connection, and revokes object URLs.

## Storage lifecycle

| Event | Effect |
| --- | --- |
| Chunk received | `chunks` row written, progress updated, no blob retained until the end. |
| `VERIFY { ok: true }` | Chunks assembled into one `Blob`, written to `files`, chunk rows deleted, transfer → `completed`. |
| Cancel / fail | Chunk rows deleted; the transfer row is kept for history with its final status. |
| Interrupt | Chunk rows kept so the transfer can resume; the OPFS source is kept as well. |
| Favorite | `favorite = 1`; excluded from pruning. |
| Prune | Keeps favorites, trims non-favorites to `historyLimit`. |
| Export | JSON snapshot of `devices`, `transfers`, `texts`, `settings` — never file blobs. |
| Clear | Deletes transfers, files, chunks and texts in one transaction; devices and settings survive. |

## PWA shell

`public/manifest.webmanifest` declares the installable app (name, icons, standalone display, theme colours) and `public/sw.js` caches the shell for offline start. The service worker never caches transfer payloads or API responses; there is no API. Registering the worker happens once in `src/main.tsx`.

## Where to change what

| Goal | Touch |
| --- | --- |
| Change chunk size or backpressure | `src/lib/constants.ts`, `src/lib/transfer.ts` |
| Add a frame type | `docs/protocol.md`, `src/lib/transfer.ts`, `src/lib/peer.ts` |
| Change pairing UX | `src/components/PairingDialog.tsx`, `src/lib/pairing.ts` |
| Change identity or hashing | `src/lib/device.ts` (keep keys non-extractable) |
| Add a persisted field | `src/lib/db.ts` with a Dexie schema version bump |
| Change relay limits | `server/index.mjs` env config, `docs/protocol.md` |
| Change the edge relay | `workers/signaling/` — mirror the Node behaviour |
| Restyle the shell | `src/styles.css` tokens, then `src/components/*` |