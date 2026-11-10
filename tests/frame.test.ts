import { describe, expect, it } from 'vitest';
import { FRAME, decodeChunkFrame, decodeFrame, decodeJsonFrame, encodeChunkFrame, encodeFrame, encodeJsonFrame } from '../src/lib/frame';

describe('data channel framing', () => {
  it('round trips a control frame', () => {
    const frame = encodeFrame(FRAME.META, new Uint8Array([1, 2, 3]));
    const decoded = decodeFrame(frame);
    expect(decoded?.type).toBe(FRAME.META);
    expect(Array.from(decoded!.payload)).toEqual([1, 2, 3]);
  });

  it('round trips JSON control payloads', () => {
    const frame = encodeJsonFrame(FRAME.META, { transferId: 'abc', size: 42 });
    const decoded = decodeFrame(frame);
    expect(decodeJsonFrame<{ transferId: string; size: number }>(decoded!.payload)).toEqual({ transferId: 'abc', size: 42 });
  });

  it('rejects truncated or lying length headers', () => {
    expect(decodeFrame(new ArrayBuffer(3))).toBeNull();
    const buffer = new Uint8Array(encodeFrame(FRAME.TEXT, new Uint8Array([9, 9])));
    new DataView(buffer.buffer).setUint32(1, 4096);
    expect(decodeFrame(buffer)).toBeNull();
  });

  it('round trips chunk headers with 64 KiB bodies', () => {
    const data = new Uint8Array(64 * 1024);
    data[0] = 7;
    data[data.length - 1] = 255;
    const frame = encodeChunkFrame('transfer-id-123', 17, data);
    const outer = decodeFrame(frame);
    expect(outer?.type).toBe(FRAME.CHUNK);
    const chunk = decodeChunkFrame(outer!.payload);
    expect(chunk?.id).toBe('transfer-id-123');
    expect(chunk?.seq).toBe(17);
    expect(chunk?.data.byteLength).toBe(64 * 1024);
    expect(chunk?.data[0]).toBe(7);
    expect(chunk?.data[chunk!.data.length - 1]).toBe(255);
  });

  it('rejects malformed chunk payloads', () => {
    expect(decodeChunkFrame(new Uint8Array([0, 0]))).toBeNull();
    expect(decodeChunkFrame(new Uint8Array([5, 1, 2]))).toBeNull();
  });

  it('encodes every frame type in the documented range', () => {
    const types = Object.values(FRAME);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) expect(type).toBeGreaterThan(0);
  });
});
