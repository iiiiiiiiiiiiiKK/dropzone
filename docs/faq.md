# DROPZONE FAQ

Short answers to the questions that actually come up. Wire format, state machine and data tables live in [protocol.md](protocol.md) and [architecture.md](architecture.md).

- [Privacy and data](#privacy-and-data)
- [Pasting and sending](#pasting-and-sending)
- [Connecting two devices](#connecting-two-devices)
- [Transfers and limits](#transfers-and-limits)
- [Hosting and deployment](#hosting-and-deployment)

## Privacy and data

### Is my file uploaded anywhere?

No. File bytes travel over an `RTCDataChannel` between the two browsers. The signaling relay accepts small JSON control frames only — there is no upload endpoint, no object storage, and no code path that posts file content to a server. The only server-side state is an in-memory roster of device ids, public keys and pending pairing invitations.

### Does the relay know my file names?

No. Names, MIME types and sizes travel inside the encrypted DataChannel (`META`), never through the relay.

### Is my history synced between devices?

No. History, favorites and text notes live in that browser's IndexedDB, scoped to the exact origin. Two devices have two independent histories; clearing site data on one does not touch the other. Use **Settings → Export** when you want a copy.

### Why is there no account?

An account means an identity on someone else's server and a file store to go with it. DROPZONE's identity is an ECDSA P-256 keypair generated inside your browser, and pairing is the entire trust model: two devices that consumed the same one-time QR trust each other. Nothing to sign up for, nothing to log into, nothing to breach.

### Can I delete everything, permanently?

Yes. **Settings → Clear history** deletes transfers, files, chunks and texts from IndexedDB in one transaction; paired devices and settings stay. For a full wipe, clear site data for the origin in the browser — that also destroys this device's keypair, so it must be paired again.

## Pasting and sending

### Why does Ctrl/⌘+V do nothing on iOS?

iOS Safari exposes no scripted clipboard read to web pages, so paste cannot be triggered from the page. Paste has to come from the system menu (long-press → Paste) on a focused editable element, and what arrives depends on the browser. On iPhone, the file picker or share sheet is the reliable path.

### Why do I have to click the page before pasting on desktop?

`navigator.clipboard.read()` requires a focused document **and** a user gesture. No gesture, no clipboard read — that is browser policy, not a permission prompt you can pre-approve. Click once inside the page, then paste.

### Are pasted images re-encoded?

No. The raw bytes of the clipboard file are used as-is, so a PNG screenshot stays byte-identical. Several images pasted in one gesture become several queue items.

### Can I send text instead of a file?

Yes — the text/clipboard panel sends a snippet as a `TEXT` frame. It arrives as a selectable card and is stored in local history like any other item.

## Connecting two devices

### My two devices cannot connect. What now?

Work through it in order:

1. **Is a relay reachable?** Open Settings and read the relay status. "Offline" means nothing will pair; a static host with no relay configured never connects.
2. **Is the code fresh?** Invitations expire after five minutes and are single-use — generate a new one.
3. **Did ICE fail?** Behind symmetric NAT or a corporate firewall there may be no direct path. Without TURN, the app reports that instead of retrying forever.
4. **Is one side suspended?** A backgrounded PWA or a sleeping laptop drops the channel.

### Do I need TURN?

Only when direct connectivity fails. STUN covers most home and mobile networks. Symmetric NAT, some carrier-grade NATs and restrictive enterprise firewalls need a relay: point the signaling service at coturn (`TURN_URLS`, `TURN_SECRET`) and it mints short-lived HMAC credentials per device. Without it the client degrades to STUN-only and says so.

### What does the safety number protect against?

A compromised or malicious relay substituting a public key during pairing. It is a fingerprint of both public keys, rendered identically on both screens; if the numbers match when compared out of band, no substitution happened. It is a human check — the app cannot perform it for you.

### What happens if I unpair a device?

The peer leaves your roster and stops appearing as a quick-send target. Its public key is removed on your side, so reconnecting requires a new invitation. There is no global revocation list — the other device may still hold *your* public key, which is why you should only unpair hardware you control.

## Transfers and limits

### Is there a maximum file size?

No fixed ceiling in the client. The practical limits are the browser's IndexedDB quota and the memory needed to assemble the final `Blob`. Chunks stream into the `chunks` table as they arrive, so neither side holds the whole file in memory while transferring. Very large transfers on a device with little free space fail at the quota boundary — export and clear history first.

### What happens if the connection drops mid-transfer?

Within a live session the receiver answers `ACCEPT` with the last contiguous chunk offset and the sender resumes there. If the page reloaded, the transfer is marked `interrupted` and can only be restarted from the beginning — cross-reload resume does not exist in this version.

### What happens if the SHA-256 digest does not match?

The receiver answers `VERIFY { ok: false }` and the sender may retry once. A second mismatch marks the transfer `failed` with the error stored on the row. Nothing is silently accepted, and the partial payload is discarded instead of being presented as complete.

### Why 64 KiB chunks?

Large enough that per-chunk overhead is negligible on a DataChannel, small enough that `bufferedAmount` stays responsive and a cancel or resume loses little work. The sender steps down to 16 KiB when the link is buffer-limited.

### Does receiving work when the tab is in the background?

Partially, and not reliably. Browsers throttle or suspend background tabs and installed PWAs; when that happens receiving stops. Keep both sides in the foreground for anything important. It is a browser scheduling constraint, not a switch the app can flip.

### Can I send to more than one device at once?

Not in this version. Transfers are one-to-one, one peer connection per paired device; multi-peer fan-out is on the roadmap.

### Does it work on iPhone or iPad?

Yes, with caveats: receiving works while the tab is foregrounded, sending through the file picker works, but scripted clipboard reads do not exist on iOS and background receiving stops when Safari suspends the tab. iOS Safari 16.4+ is the target baseline.

## Hosting and deployment

### Is the GitHub Pages demo fully functional?

It serves the full static UI — layout, history, paste, settings, install. Pairing needs a signaling relay, which a static host cannot run, so without a configured `wss://` endpoint the app shows its offline state. Self-host the Node relay (or the Worker variant) and point `VITE_SIGNAL_URL` or `window.__DROPZONE_CONFIG__` at it.

### Can I self-host everything?

Yes. `pnpm build` produces a static bundle, `server/index.mjs` is the Node relay, `workers/signaling/` is the edge variant, and coturn is a standard external service. Steps are in [deployment.md](deployment.md).

### Does the relay scale horizontally?

Not as written. Roster, pair links and pending invitations live in process memory, so a second instance knows nothing about the first. A shared store changes that; the Durable Object variant is a single coordinator by design.

### Why does the relay see my IP and device name?

It terminates your WebSocket, so it necessarily sees the connection's source address, the display name you set, your public key and presence transitions. It does not see files. If that is unacceptable on a given network, self-host the relay — it is a few hundred lines of Node.

### Where do I report a security issue?

Privately — see [SECURITY.md](../SECURITY.md). Do not open a public issue for an active exploit.
