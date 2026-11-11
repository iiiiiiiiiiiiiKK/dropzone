/**
 * DataChannel wire framing (see docs/protocol.md §2).
 *
 *   [1 byte type][4 byte big-endian payload length][payload]
 *
 * Control payloads are UTF-8 JSON. CHUNK payloads are:
 *   [1 byte id length][id utf8][4 byte seq][raw data]
 */
export const FRAME = {
  HELLO: 1,
  META: 2,
  ACCEPT: 3,
  REJECT: 4,
  CHUNK: 5,
  DONE: 6,
  VERIFY: 7,
  CANCEL: 8,
  TEXT: 9,
  PING: 10,
  PONG: 11,
} as const;

export type FrameType = (typeof FRAME)[keyof typeof FRAME];

export const MAX_CHUNK_ID_LENGTH = 255;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeFrame(type: number, payload: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(5 + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, type);
  view.setUint32(1, payload.byteLength);
  new Uint8Array(buffer, 5).set(payload);
  return buffer;
}

export function decodeFrame(buffer: ArrayBuffer | ArrayBufferView): { type: number; payload: Uint8Array } | null {
  const view =
    buffer instanceof ArrayBuffer
      ? new DataView(buffer)
      : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.byteLength < 5) return null;
  const type = view.getUint8(0);
  const length = view.getUint32(1);
  if (length > view.byteLength - 5) return null;
  const payload = new Uint8Array(view.buffer, view.byteOffset + 5, length);
  return { type, payload };
}

export function encodeJsonFrame(type: number, value: unknown): ArrayBuffer {
  return encodeFrame(type, encoder.encode(JSON.stringify(value)));
}

export function decodeJsonFrame<T>(payload: Uint8Array): T | null {
  try {
    return JSON.parse(decoder.decode(payload)) as T;
  } catch {
    return null;
  }
}

/**
 * Picks a payload size that keeps the whole frame inside one SCTP message.
 *
 * A CHUNK frame is 5 (header) + 1 (id length) + id + 4 (seq) + data, so the data
 * budget must subtract the frame overhead from the peer's maxMessageSize.
 * Safari caps at 64 KiB and closes the channel when a frame exceeds it.
 */
export function computeChunkSize(maxMessageSize: number, frameOverhead: number, preferred: number, minimum: number): number {
  const safeMax = Number.isFinite(maxMessageSize) && maxMessageSize > 0 ? maxMessageSize : 64 * 1024;
  const budget = Math.floor((safeMax - frameOverhead) / 1024) * 1024;
  if (!Number.isFinite(budget) || budget <= 0) return minimum;
  return Math.max(minimum, Math.min(preferred, budget));
}

export function encodeChunkFrame(id: string, seq: number, data: Uint8Array): ArrayBuffer {
  const idBytes = encoder.encode(id);
  if (idBytes.byteLength > MAX_CHUNK_ID_LENGTH) throw new Error('Chunk transfer id is too long');
  const payload = new Uint8Array(1 + idBytes.byteLength + 4 + data.byteLength);
  payload[0] = idBytes.byteLength;
  payload.set(idBytes, 1);
  new DataView(payload.buffer).setUint32(1 + idBytes.byteLength, seq);
  payload.set(data, 5 + idBytes.byteLength);
  return encodeFrame(FRAME.CHUNK, payload);
}

export function decodeChunkFrame(payload: Uint8Array): { id: string; seq: number; data: Uint8Array } | null {
  if (payload.byteLength < 6) return null;
  const idLength = payload[0]!;
  if (payload.byteLength < 1 + idLength + 4) return null;
  const id = decoder.decode(payload.subarray(1, 1 + idLength));
  const seq = new DataView(payload.buffer, payload.byteOffset + 1 + idLength, 4).getUint32(0);
  return { id, seq, data: payload.subarray(5 + idLength) };
}
