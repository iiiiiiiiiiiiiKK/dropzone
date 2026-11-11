/**
 * Origin Private File System helpers used for cross-reload resume.
 *
 * A page reload destroys every `File` handle, so an interrupted outgoing transfer
 * could never be resumed from disk. Persisting the source bytes into OPFS fixes
 * that: after the reload the same bytes are addressable by transfer id, and the
 * receiver (which keeps its chunks in IndexedDB) reports how far it got.
 *
 * Everything degrades gracefully: if OPFS is unavailable or the quota is exhausted
 * the caller falls back to streaming straight from the `File`.
 */

const DIR_NAME = 'dropzone-transfers';

/** Below this size an OPFS copy costs more than it saves; just resend. */
export const OPFS_MIN_SIZE = 1 * 1024 * 1024;

const COPY_PIECE = 4 * 1024 * 1024;

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function transfersDir(create = false): Promise<FileSystemDirectoryHandle | null> {
  if (!opfsSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR_NAME, { create });
  } catch {
    return null;
  }
}

export function sourceFileName(transferId: string): string {
  // Ids are base64url-ish and already filesystem safe; keep one extension for tools.
  return transferId.replace(/[^A-Za-z0-9_-]/g, '_') + '.bin';
}

/** Streams a File into OPFS, reporting progress. Throws when the quota is hit. */
export async function putSource(
  transferId: string,
  file: File,
  onProgress?: (written: number) => void,
): Promise<boolean> {
  const dir = await transfersDir(true);
  if (!dir) return false;
  try {
    const handle = await dir.getFileHandle(sourceFileName(transferId), { create: true });
    const writable = await handle.createWritable();
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + COPY_PIECE, file.size);
      await writable.write(await file.slice(offset, end).arrayBuffer());
      offset = end;
      onProgress?.(offset);
    }
    await writable.close();
    return true;
  } catch {
    // Quota exceeded or a locked handle: drop the partial file and use the File.
    await dropSource(transferId);
    return false;
  }
}

export async function hasSource(transferId: string): Promise<boolean> {
  const dir = await transfersDir(false);
  if (!dir) return false;
  try {
    await dir.getFileHandle(sourceFileName(transferId));
    return true;
  } catch {
    return false;
  }
}

export async function sourceSize(transferId: string): Promise<number> {
  const dir = await transfersDir(false);
  if (!dir) return 0;
  try {
    const handle = await dir.getFileHandle(sourceFileName(transferId));
    return (await handle.getFile()).size;
  } catch {
    return 0;
  }
}

export async function readSourceSlice(transferId: string, start: number, end: number): Promise<ArrayBuffer> {
  const dir = await transfersDir(false);
  if (!dir) throw new Error('OPFS unavailable');
  const handle = await dir.getFileHandle(sourceFileName(transferId));
  const file = await handle.getFile();
  return file.slice(start, Math.min(end, file.size)).arrayBuffer();
}

export async function dropSource(transferId: string): Promise<void> {
  const dir = await transfersDir(false);
  if (!dir) return;
  try {
    await dir.removeEntry(sourceFileName(transferId));
  } catch {
    /* already gone */
  }
}

/** Removes OPFS blobs that no transfer record points at any more. */
export async function pruneSources(keep: Set<string>): Promise<number> {
  const dir = await transfersDir(false);
  if (!dir) return 0;
  let removed = 0;
  try {
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      const id = name.replace(/\.bin$/, '');
      if (keep.has(id)) continue;
      try {
        await dir.removeEntry(name);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* directory iteration unsupported */
  }
  return removed;
}
