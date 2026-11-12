/**
 * Resume maths for chunked transfers.
 *
 * The data channel is ordered and reliable, so the chunks stored for a transfer
 * form a contiguous run starting at seq 0. A retry can therefore resume at
 * `count * chunkSize`, but only if every seq from 0..count-1 is present — a gap
 * means the run is not resumable and the transfer must restart from zero.
 */
export type StoredChunk = { seq: number; byteLength: number };

/** Offset plus the number of contiguous chunks it covers. */
export function contiguousInfo(chunks: StoredChunk[], chunkSize: number): { offset: number; count: number } {
  if (chunks.length === 0) return { offset: 0, count: 0 };
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) return { offset: 0, count: 0 };
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
  let expected = 0;
  let offset = 0;
  for (const chunk of sorted) {
    if (chunk.seq !== expected) break;
    offset += chunk.byteLength;
    expected += 1;
  }
  return { offset, count: expected };
}

export function contiguousOffset(chunks: StoredChunk[], chunkSize: number): number {
  return contiguousInfo(chunks, chunkSize).offset;
}

/** Backoff between automatic retries: fast first, patient later. */
export function retryDelayMs(attempt: number): number {
  const base = 800;
  const capped = Math.min(attempt, 4);
  return Math.min(8_000, base * 2 ** (capped - 1));
}

/** Errors worth retrying automatically; user cancel and rejection are not. */
export function isRetryable(error: string): boolean {
  if (/canceled|declined|rejected/i.test(error)) return false;
  return /data channel closed|channel closed|timed out|Connection failed|not ready|did not answer|stalled|verification timed out/i.test(error);
}
/**
 * Marks transfers that were still in flight when the page went away.
 * Called once at boot; without it a reloaded tab shows a transfer "transferring"
 * forever and the resume pass never sees it.
 */
export async function reconcileInterruptedTransfers(): Promise<number> {
  const { db } = await import('./db');
  const all = await db.transfers.toArray();
  const stale = all.filter((record) => record.status === 'transferring' || record.status === 'verifying' || record.status === 'queued');
  for (const record of stale) {
    await db.transfers.update(record.id, {
      status: 'interrupted',
      error: record.error ?? 'Interrupted by a page reload',
    });
  }
  return stale.length;
}