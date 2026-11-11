import { sha256 } from '@noble/hashes/sha256';
import { CHUNK_SIZE, MIN_CHUNK_SIZE } from './constants';
import { db, saveFile, type TextRecord, type TransferRecord } from './db';
import { newNonce, sign, verify, type Identity } from './device';
import { t } from './i18n';
import { FRAME, computeChunkSize, decodeChunkFrame, decodeFrame, decodeJsonFrame, encodeChunkFrame, encodeJsonFrame } from './frame';
import type { PeerMesh } from './peer';
import { trace } from './log';
import { contiguousOffset, isRetryable, retryDelayMs } from './resume';
import { randomId, safeFileName } from './utils';

const ACCEPT_TIMEOUT_MS = 20_000;
const VERIFY_TIMEOUT_MS = 120_000;
const HASHLIB_PIECE = 4 * 1024 * 1024;
/** How long a receiver tolerates silence before declaring the sender dead. */
const STALL_TIMEOUT_MS = 25_000;
const STALL_CHECK_MS = 5_000;
/** Automatic attempts per transfer before giving up (transient channel drops heal here). */
const MAX_SEND_ATTEMPTS = 3;

export type TransferPhase = 'hashing' | 'waiting' | 'sending' | 'receiving' | 'verifying' | 'done' | 'failed';

export type TransferProgress = {
  id: string;
  deviceId: string;
  name: string;
  size: number;
  transferred: number;
  speed: number;
  etaSec: number | null;
  phase: TransferPhase;
  direction: 'in' | 'out';
};

export type TransferNotice = {
  level: 'info' | 'success' | 'error' | 'warn';
  title: string;
  body?: string;
};

export type TransferEvents = {
  onProgress: (progress: TransferProgress) => void;
  onRecord: (record: TransferRecord) => void;
  onText: (record: TextRecord) => void;
  onNotice: (notice: TransferNotice) => void;
  /** Fired after a received file is verified and stored, so the UI can offer it. */
  onIncomingReady?: (transferId: string, name: string, mime: string) => void;
  onPeerVerified: (deviceId: string, verified: boolean, publicKey?: string) => void;
  resolveDeviceName: (deviceId: string) => string;
  autoAccept: () => boolean;
  /** Called when auto-receive is off; resolve true to accept the transfer. */
  requestAccept?: (deviceId: string, name: string, size: number) => Promise<boolean>;
};

type Pending = {
  resolve: (value: IncomingControl) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type IncomingControl = { kind: 'accept'; offset: number } | { kind: 'reject'; reason: string } | { kind: 'verify'; ok: boolean };

type IncomingState = {
  id: string;
  deviceId: string;
  name: string;
  mime: string;
  size: number;
  expectedSha: string;
  received: number;
  nextSeq: number;
  hasher: ReturnType<typeof sha256.create>;
  buffer: Array<{ transferId: string; seq: number; data: ArrayBuffer }>;
  lastEmit: number;
  startedAt: number;
  lastChunkAt: number;
  watchdog?: ReturnType<typeof setTimeout>;
};

const encoder = new TextEncoder();

async function hashFile(file: Blob, onProgress?: (done: number) => void): Promise<string> {
  const hasher = sha256.create();
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + HASHLIB_PIECE, file.size);
    const piece = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    hasher.update(piece);
    offset = end;
    onProgress?.(offset);
  }
  const digest = hasher.digest();
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class TransferEngine {
  private pending = new Map<string, Pending>();
  private incoming = new Map<string, IncomingState>();
  private cancelled = new Set<string>();
  private helloSent = new Set<string>();
  private messageQueues = new Map<string, Promise<void>>();
  /** Chunk size pinned per transfer id so a resumed attempt keeps the same seq grid. */
  private chunkSizes = new Map<string, number>();

  constructor(
    private readonly options: {
      identity: Identity;
      mesh: PeerMesh;
      events: TransferEvents;
    },
  ) {}

  greet(deviceId: string): void {
    if (this.helloSent.has(deviceId) && this.options.mesh.isOpen(deviceId)) return;
    const nonce = newNonce();
    void sign(this.options.identity, `${this.options.identity.deviceId}|${nonce}`).then((signature) => {
      const sent = this.options.mesh.send(
        deviceId,
        encodeJsonFrame(FRAME.HELLO, {
          v: 1,
          deviceId: this.options.identity.deviceId,
          publicKey: this.options.identity.publicKey,
          nonce,
          sig: signature,
        }),
      );
      if (sent) this.helloSent.add(deviceId);
    });
  }

  async sendFiles(deviceId: string, files: File[]): Promise<string[]> {
    const ids: string[] = [];
    for (const file of files) {
      ids.push(await this.sendOne(deviceId, file));
    }
    return ids;
  }

  async sendText(deviceId: string, body: string): Promise<TextRecord> {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Nothing to send');
    const record: TextRecord = {
      id: randomId(12),
      content: trimmed,
      direction: 'out',
      deviceId,
      deviceName: this.options.events.resolveDeviceName(deviceId),
      createdAt: Date.now(),
      favorite: 0,
    };
    await this.openChannel(deviceId);
    const sent = this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.TEXT, { textId: record.id, body: trimmed, createdAt: record.createdAt }));
    if (!sent) throw new Error('Connection is not ready');
    await db.texts.put(record);
    this.options.events.onText(record);
    // A sent note is part of the local history just like a file, so record it.
    const transferRecord: TransferRecord = {
      id: `text-${record.id}`,
      kind: 'text',
      name: record.content.slice(0, 64),
      mime: 'text/plain',
      size: encoder.encode(record.content).byteLength,
      direction: 'out',
      deviceId,
      deviceName: record.deviceName,
      createdAt: record.createdAt,
      completedAt: record.createdAt,
      status: 'completed',
      favorite: 0,
      body: record.content,
    };
    await db.transfers.put(transferRecord);
    this.options.events.onRecord(transferRecord);
    return record;
  }

  cancel(transferId: string): void {
    this.cancelled.add(transferId);
    const pending = this.pending.get(transferId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(transferId);
      pending.reject(new Error('Canceled'));
    }
    const incoming = this.incoming.get(transferId);
    if (incoming) {
      this.options.mesh.send(incoming.deviceId, encodeJsonFrame(FRAME.CANCEL, { transferId, reason: 'canceled' }));
      void this.cleanupIncoming(transferId);
    }
  }

  /**
   * Messages are serialised per peer: a data channel delivers frames in order, but
   * async handlers would otherwise let DONE overtake the final CHUNK, which breaks
   * digest verification on tiny files.
   */
  handleMessage(deviceId: string, buffer: ArrayBuffer): Promise<void> {
    const previous = this.messageQueues.get(deviceId) ?? Promise.resolve();
    const next = previous
      .then(() => this.processMessage(deviceId, buffer))
      .catch((error: unknown) => {
        this.options.events.onNotice({ level: 'error', title: 'Transfer error', body: (error as Error).message });
      });
    this.messageQueues.set(deviceId, next);
    return next;
  }

  private async processMessage(deviceId: string, buffer: ArrayBuffer): Promise<void> {
    const frame = decodeFrame(buffer);
    if (!frame) return;
    switch (frame.type) {
      case FRAME.HELLO:
        await this.handleHello(deviceId, frame.payload);
        return;
      case FRAME.META:
        await this.handleMeta(deviceId, frame.payload);
        return;
      case FRAME.ACCEPT:
      case FRAME.REJECT:
      case FRAME.VERIFY: {
        const control = decodeJsonFrame<{ transferId: string; offset?: number; reason?: string; ok?: boolean }>(frame.payload);
        if (!control?.transferId) return;
        const pending = this.pending.get(control.transferId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(control.transferId);
        if (frame.type === FRAME.ACCEPT) pending.resolve({ kind: 'accept', offset: control.offset ?? 0 });
        else if (frame.type === FRAME.REJECT) pending.resolve({ kind: 'reject', reason: control.reason ?? 'rejected' });
        else pending.resolve({ kind: 'verify', ok: Boolean(control.ok) });
        return;
      }
      case FRAME.CHUNK:
        await this.handleChunk(frame.payload);
        return;
      case FRAME.DONE:
        await this.handleDone(deviceId, frame.payload);
        return;
      case FRAME.CANCEL: {
        const control = decodeJsonFrame<{ transferId: string; reason?: string }>(frame.payload);
        if (!control?.transferId) return;
        if (control.reason === 'retry') {
          // The sender is renegotiating; keep what we have so the retry resumes.
          this.incoming.delete(control.transferId);
          return;
        }
        this.cancelled.add(control.transferId);
        await this.failTransfer(control.transferId, control.reason === 'canceled' ? 'canceled' : 'Canceled by the other device');
        return;
      }
      case FRAME.TEXT: {
        const control = decodeJsonFrame<{ textId: string; body: string; createdAt: number }>(frame.payload);
        if (!control?.textId || typeof control.body !== 'string') return;
        const deviceName = this.options.events.resolveDeviceName(deviceId);
        const record: TextRecord = {
          id: control.textId,
          content: control.body,
          direction: 'in',
          deviceId,
          deviceName,
          createdAt: control.createdAt || Date.now(),
          favorite: 0,
        };
        await db.texts.put(record);
        const inboundRecord: TransferRecord = {
          id: `text-${record.id}`,
          kind: 'text',
          name: record.content.slice(0, 64),
          mime: 'text/plain',
          size: encoder.encode(record.content).byteLength,
          direction: 'in',
          deviceId,
          deviceName,
          createdAt: record.createdAt,
          completedAt: record.createdAt,
          status: 'completed',
          favorite: 0,
          body: record.content,
        };
        await db.transfers.put(inboundRecord);
        this.options.events.onRecord(inboundRecord);
        this.options.events.onText(record);
        this.options.events.onNotice({ level: 'info', title: t('notice.text', { name: deviceName }), body: record.content.slice(0, 120) });
        return;
      }
      case FRAME.PING:
        this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.PONG, { ts: Date.now() }));
        return;
      default:
        return;
    }
  }

  private async handleHello(deviceId: string, payload: Uint8Array): Promise<void> {
    const control = decodeJsonFrame<{ deviceId: string; publicKey: string; nonce: string; sig: string }>(payload);
    if (!control?.deviceId || !control.publicKey || !control.nonce || !control.sig) return;
    if (control.deviceId !== deviceId) {
      this.options.events.onPeerVerified(deviceId, false);
      return;
    }
    const ok = await verify(control.publicKey, `${control.deviceId}|${control.nonce}`, control.sig);
    this.options.events.onPeerVerified(deviceId, ok, control.publicKey);
  }

  private async handleMeta(deviceId: string, payload: Uint8Array): Promise<void> {
    const meta = decodeJsonFrame<{ transferId: string; name: string; mime: string; size: number; sha256: string }>(payload);
    if (!meta?.transferId || typeof meta.size !== 'number') return;
    const deviceName = this.options.events.resolveDeviceName(deviceId);
    const autoAccept = this.options.events.autoAccept();
    const accepted = autoAccept || (await this.options.events.requestAccept?.(deviceId, meta.name, meta.size)) === true;
    if (!accepted) {
      this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.REJECT, { transferId: meta.transferId, reason: 'declined' }));
      this.options.events.onNotice({ level: 'warn', title: t('notice.declined'), body: t('notice.declinedBody') });
      return;
    }
    // A retry re-sends META with the same transfer id. Anything already stored from
    // the previous attempt is contiguous (the channel is ordered), so reporting its
    // byte count lets the sender resume instead of starting over.
    const stored = await db.chunks.where('transferId').equals(meta.transferId).toArray();
    const resumeOffset = contiguousOffset(
      stored.map((chunk) => ({ seq: chunk.seq, byteLength: chunk.data.byteLength })),
      Number((meta as { chunkSize?: number }).chunkSize) || 0,
    );
    const state: IncomingState = {
      id: meta.transferId,
      deviceId,
      name: safeFileName(meta.name),
      mime: meta.mime || 'application/octet-stream',
      size: meta.size,
      expectedSha: meta.sha256 ?? '',
      received: resumeOffset,
      nextSeq: stored.length,
      hasher: sha256.create(),
      buffer: [],
      lastEmit: 0,
      startedAt: Date.now(),
      lastChunkAt: Date.now(),
    };
    if (resumeOffset > 0) trace('transfer', 'resuming receive', { id: meta.transferId, resumeOffset, stored: stored.length });
    this.incoming.set(meta.transferId, state);
    const record: TransferRecord = {
      id: meta.transferId,
      kind: 'file',
      name: state.name,
      mime: state.mime,
      size: state.size,
      direction: 'in',
      deviceId,
      deviceName,
      createdAt: Date.now(),
      status: 'transferring',
      favorite: 0,
    };
    await db.transfers.put(record);
    this.options.events.onRecord(record);
    this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.ACCEPT, { transferId: meta.transferId, offset: resumeOffset }));
    this.armWatchdog(state);
    this.options.events.onNotice({ level: 'info', title: t('notice.incoming', { name: deviceName }), body: state.name });
  }

  /**
   * Receivers must notice a dead sender. Safari closes the data channel without a
   * close event reaching us in time, so a stall watchdog is the only reliable signal.
   */
  private armWatchdog(state: IncomingState): void {
    if (state.watchdog) clearTimeout(state.watchdog);
    state.watchdog = setTimeout(() => {
      if (!this.incoming.has(state.id)) return;
      const stalledFor = Date.now() - state.lastChunkAt;
      if (stalledFor < STALL_TIMEOUT_MS) {
        this.armWatchdog(state);
        return;
      }
      trace('transfer', 'receiver stalled', { id: state.id, stalledFor, received: state.received, size: state.size });
      void this.failTransfer(state.id, t('xfer.stalled'), true);
      this.incoming.delete(state.id);
      this.options.events.onProgress({
        id: state.id,
        deviceId: state.deviceId,
        name: state.name,
        size: state.size,
        transferred: state.received,
        speed: 0,
        etaSec: null,
        phase: 'failed',
        direction: 'in',
      });
    }, STALL_CHECK_MS);
  }

  private async handleChunk(payload: Uint8Array): Promise<void> {
    const chunk = decodeChunkFrame(payload);
    if (!chunk) return;
    const state = this.incoming.get(chunk.id);
    if (!state) return;
    state.lastChunkAt = Date.now();
    state.hasher.update(chunk.data);
    state.received += chunk.data.byteLength;
    state.nextSeq = chunk.seq + 1;
    state.buffer.push({ transferId: chunk.id, seq: chunk.seq, data: chunk.data.slice().buffer });
    if (state.buffer.length >= 24) await this.flushChunks(state);
    const now = Date.now();
    if (now - state.lastEmit > 140 || state.received >= state.size) {
      state.lastEmit = now;
      this.emitProgress(this.progressFrom(state));
    }
  }

  private async handleDone(deviceId: string, payload: Uint8Array): Promise<void> {
    const control = decodeJsonFrame<{ transferId: string; sha256: string }>(payload);
    if (!control?.transferId) return;
    const state = this.incoming.get(control.transferId);
    if (!state) return;
    await this.flushChunks(state);
    const chunks = await db.chunks.where('transferId').equals(control.transferId).sortBy('seq');
    const parts = chunks.map((chunk) => new Uint8Array(chunk.data));
    const blob = new Blob(parts as BlobPart[], { type: state.mime });
    // Hash the stored parts, not the streaming hasher: the digest must describe exactly
    // what a download would contain, independent of frame arrival timing.
    const verifier = sha256.create();
    for (const part of parts) verifier.update(part);
    const digest = Array.from(verifier.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const expected = control.sha256 || state.expectedSha;
    const ok = blob.size === state.size && (!expected || digest === expected);
    if (!ok) {
      trace('transfer', 'verification failed', {
        expected,
        digest,
        expectedSize: state.size,
        actualSize: blob.size,
        chunks: chunks.length,
        streamedDigest: Array.from(state.hasher.digest().slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      });
    }
    if (ok) {
      await saveFile(control.transferId, blob, blob.size);
      await db.transfers.update(control.transferId, {
        status: 'completed',
        completedAt: Date.now(),
        sha256: digest,
        thumbnail: state.mime.startsWith('image/') ? blob.slice(0, Math.min(blob.size, 512 * 1024)) : undefined,
      });
      this.options.events.onNotice({ level: 'success', title: t('notice.complete'), body: state.name });
      this.options.events.onIncomingReady?.(control.transferId, state.name, state.mime);
    } else {
      await db.transfers.update(control.transferId, { status: 'failed', error: `Checksum mismatch (${blob.size}/${state.size} bytes)` });
      this.options.events.onNotice({ level: 'error', title: t('notice.mismatch'), body: t('notice.mismatchBody', { name: state.name }) });
    }
    this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.VERIFY, { transferId: control.transferId, ok, sha256: digest }));
    const result = await db.transfers.get(control.transferId);
    if (result) this.options.events.onRecord(result);
    await this.cleanupIncoming(control.transferId);
    this.emitProgress({ ...this.progressFrom(state), transferred: state.size, phase: ok ? 'done' : 'failed' });
  }

  private async flushChunks(state: IncomingState): Promise<void> {
    if (state.buffer.length === 0) return;
    const batch = state.buffer.splice(0, state.buffer.length);
    await db.chunks.bulkPut(batch);
  }

  private async cleanupIncoming(transferId: string): Promise<void> {
    const stale = this.incoming.get(transferId);
    if (stale?.watchdog) clearTimeout(stale.watchdog);
    this.incoming.delete(transferId);
    await db.chunks.where('transferId').equals(transferId).delete();
  }

  private progressFrom(state: IncomingState): TransferProgress {
    const elapsed = Math.max((Date.now() - state.startedAt) / 1000, 0.001);
    const speed = state.received / elapsed;
    const remaining = Math.max(state.size - state.received, 0);
    return {
      id: state.id,
      deviceId: state.deviceId,
      name: state.name,
      size: state.size,
      transferred: state.received,
      speed,
      etaSec: speed > 0 ? remaining / speed : null,
      phase: 'receiving',
      direction: 'in',
    };
  }

  private emitProgress(progress: TransferProgress): void {
    this.options.events.onProgress(progress);
  }

  private async openChannel(deviceId: string): Promise<void> {
    try {
      await this.options.mesh.ensure(deviceId);
    } catch (error) {
      const message = (error as Error).message;
      const hint = /timed out|Connection failed|not ready/i.test(message) ? t('notice.iceHint') : '';
      throw new Error(hint ? `${message}. ${hint}` : message);
    }
    this.greet(deviceId);
  }

  private waitFor(transferId: string, kind: 'accept' | 'verify', timeoutMs: number): Promise<IncomingControl> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transferId);
        reject(new Error(kind === 'accept' ? 'The other device did not answer' : 'Verification timed out'));
      }, timeoutMs);
      this.pending.set(transferId, { resolve, reject, timer });
    });
  }

  private async sendOne(deviceId: string, file: File): Promise<string> {
    const id = randomId(12);
    const name = safeFileName(file.name || `pasted-${Date.now()}.png`);
    const mime = file.type || 'application/octet-stream';
    const deviceName = this.options.events.resolveDeviceName(deviceId);
    const record: TransferRecord = {
      id,
      kind: 'file',
      name,
      mime,
      size: file.size,
      direction: 'out',
      deviceId,
      deviceName,
      createdAt: Date.now(),
      status: 'queued',
      favorite: 0,
    };
    await db.transfers.put(record);
    this.options.events.onRecord(record);

    // Hash once: a retry must not re-read a multi-gigabyte file from disk.
    const startedHash = Date.now();
    const digest = await hashFile(file, (done) => {
      const elapsed = Math.max((Date.now() - startedHash) / 1000, 0.001);
      this.emitProgress({
        id,
        deviceId,
        name,
        size: file.size,
        transferred: done,
        speed: done / elapsed,
        etaSec: null,
        phase: 'hashing',
        direction: 'out',
      });
    });

    let lastError = 'Transfer failed';
    let finished = false;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS && !finished; attempt += 1) {
      try {
        await this.openChannel(deviceId);

        // The chunk size is pinned per transfer so a resumed attempt lines up with
        // the sequence numbers the receiver already stored.
        const pinned = this.chunkSizes.get(id);
        const frameOverhead = 5 + 1 + encoder.encode(id).byteLength + 4;
        const chunkSize = pinned ?? computeChunkSize(this.options.mesh.maxMessageSize(deviceId), frameOverhead, CHUNK_SIZE, MIN_CHUNK_SIZE);
        this.chunkSizes.set(id, chunkSize);
        trace('transfer', 'chunk budget', { attempt, pinned: Boolean(pinned), chunkSize, fileSize: file.size });

        const acceptPromise = this.waitFor(id, 'accept', ACCEPT_TIMEOUT_MS);
        const sentMeta = this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.META, { transferId: id, name, mime, size: file.size, sha256: digest, chunkSize }));
        if (!sentMeta) {
          const pendingMeta = this.pending.get(id);
          if (pendingMeta) {
            clearTimeout(pendingMeta.timer);
            this.pending.delete(id);
          }
          throw new Error('Connection is not ready');
        }
        await db.transfers.update(id, { status: 'transferring', sha256: digest });
        this.options.events.onRecord({ ...record, status: 'transferring', sha256: digest });

        const accepted = await acceptPromise;
        if (accepted.kind === 'reject') throw new Error(accepted.reason === 'declined' ? 'Declined by the other device' : 'Transfer rejected');
        const offset = accepted.kind === 'accept' ? Math.max(0, Math.min(accepted.offset, file.size)) : 0;
        if (offset > 0) trace('transfer', 'resuming send', { attempt, offset });

        let position = Math.floor(offset / chunkSize) * chunkSize;
        let seq = Math.floor(position / chunkSize);
        const startedAt = Date.now();
        let lastEmit = 0;
        while (position < file.size) {
          if (this.cancelled.has(id)) throw new Error('Canceled');
          const chunkEnd = Math.min(position + chunkSize, file.size);
          const data = new Uint8Array(await file.slice(position, chunkEnd).arrayBuffer());
          await this.options.mesh.waitForDrain(deviceId);
          const ok = this.options.mesh.send(deviceId, encodeChunkFrame(id, seq, data));
          if (!ok) throw new Error('The data channel closed during transfer');
          position = chunkEnd;
          seq += 1;
          const now = Date.now();
          if (now - lastEmit > 120 || position >= file.size) {
            lastEmit = now;
            const elapsed = Math.max((now - startedAt) / 1000, 0.001);
            const speed = (position - offset) / elapsed;
            this.emitProgress({
              id,
              deviceId,
              name,
              size: file.size,
              transferred: position,
              speed,
              etaSec: speed > 0 ? (file.size - position) / speed : null,
              phase: 'sending',
              direction: 'out',
            });
          }
        }

        await db.transfers.update(id, { status: 'verifying' });
        const verifyPromise = this.waitFor(id, 'verify', VERIFY_TIMEOUT_MS);
        this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.DONE, { transferId: id, sha256: digest, size: file.size }));
        const verification = await verifyPromise;
        const ok = verification.kind === 'verify' && verification.ok;
        if (!ok) throw new Error('Checksum mismatch');

        await db.transfers.update(id, { status: 'completed', completedAt: Date.now(), error: undefined });
        const finalRecord = await db.transfers.get(id);
        if (finalRecord) this.options.events.onRecord(finalRecord);
        this.emitProgress({ id, deviceId, name, size: file.size, transferred: file.size, speed: 0, etaSec: 0, phase: 'done', direction: 'out' });
        this.options.events.onNotice({ level: 'success', title: t('notice.sent', { name: deviceName }), body: name });
        finished = true;
      } catch (error) {
        lastError = (error as Error).message;
        const cancelled = this.cancelled.has(id);
        const retryable = !cancelled && isRetryable(lastError) && attempt < MAX_SEND_ATTEMPTS;
        await db.transfers.update(id, { status: retryable ? 'queued' : cancelled ? 'canceled' : 'failed', error: retryable ? undefined : lastError });
        const failedRecord = await db.transfers.get(id);
        if (failedRecord) this.options.events.onRecord(failedRecord);
        if (!retryable) {
          // Tell the peer to stop, then surface why.
          this.options.mesh.send(deviceId, encodeJsonFrame(FRAME.CANCEL, { transferId: id, reason: lastError }));
          this.emitProgress({ id, deviceId, name, size: file.size, transferred: 0, speed: 0, etaSec: null, phase: 'failed', direction: 'out' });
          if (!cancelled) {
            const channelProblem = /data channel closed|channel closed/i.test(lastError);
            const iceProblem = /timed out|Connection failed|not ready/i.test(lastError);
            this.options.events.onNotice({
              level: 'error',
              title: t('notice.failed'),
              body: channelProblem ? t('xfer.channelClosed') : iceProblem ? `${lastError} — ${t('notice.iceHint')}` : lastError,
            });
          }
          break;
        }
        // Retry: drop the stale channel so the next attempt negotiates a fresh path.
        trace('transfer', 'auto-retry', { attempt, reason: lastError, delay: retryDelayMs(attempt) });
        // No CANCEL here: it would make the peer discard the bytes it already stored,
        // which is exactly what the resume depends on.
        this.options.mesh.close(deviceId);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      }
    }
    this.pending.delete(id);
    this.cancelled.delete(id);
    this.chunkSizes.delete(id);
    return id;
  }

  private async failTransfer(transferId: string, reason: string, keepPartial = false): Promise<void> {
    const status = reason === 'canceled' ? 'canceled' : keepPartial ? 'interrupted' : 'failed';
    await db.transfers.update(transferId, { status, error: reason });
    const record = await db.transfers.get(transferId);
    if (record) this.options.events.onRecord(record);
    // Chunks survive an interruption so the sender's retry can resume from them.
    if (!keepPartial) await this.cleanupIncoming(transferId);
    else this.incoming.delete(transferId);
  }
}

export function progressRatio(transferred: number, size: number): number {
  if (!size) return 0;
  return Math.max(0, Math.min(1, transferred / size));
}