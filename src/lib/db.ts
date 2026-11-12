import Dexie, { type Table } from 'dexie';
import { DEFAULT_HISTORY_LIMIT, type AppSettings } from './constants';

export type DeviceRecord = {
  id: string;
  name: string;
  type: string;
  publicKey: string;
  pairedAt: number;
  lastSeen: number;
  online?: boolean;
  safetyNumber?: string;
};

export type TransferStatus =
  | 'queued'
  | 'connecting'
  | 'transferring'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'
  | 'interrupted';

export type TransferRecord = {
  id: string;
  kind: 'file' | 'text';
  name: string;
  mime: string;
  size: number;
  direction: 'in' | 'out';
  deviceId: string;
  deviceName: string;
  createdAt: number;
  completedAt?: number;
  status: TransferStatus;
  sha256?: string;
  favorite: number;
  error?: string;
  thumbnail?: Blob;
  /** Full text body for kind === 'text'; `name` only carries a short preview. */
  body?: string;
  /** Outgoing transfers: the source bytes live in OPFS under this id, so a reload can resume. */
  opfsStored?: boolean;
  /** Bytes the peer confirmed before an interruption. */
  resumeOffset?: number;
  /** Payload grid used for CHUNK sequence numbers; persisted so a reload keeps it. */
  chunkSize?: number;
};

export type FileRecord = {
  transferId: string;
  blob?: Blob;
  createdAt: number;
  size: number;
};

export type ChunkRecord = {
  transferId: string;
  seq: number;
  data: ArrayBuffer;
};

export type TextRecord = {
  id: string;
  content: string;
  direction: 'in' | 'out';
  deviceId: string;
  deviceName: string;
  createdAt: number;
  favorite: number;
};

export type SettingsRecord = { key: string; value: unknown };

class DropzoneDb extends Dexie {
  devices!: Table<DeviceRecord, string>;
  transfers!: Table<TransferRecord, string>;
  files!: Table<FileRecord, string>;
  chunks!: Table<ChunkRecord, [string, number]>;
  texts!: Table<TextRecord, string>;
  settings!: Table<SettingsRecord, string>;

  constructor() {
    super('dropzone');
    this.version(1).stores({
      devices: '&id, name, pairedAt, lastSeen',
      transfers: '&id, createdAt, status, direction, deviceId, favorite',
      files: '&transferId, createdAt',
      chunks: '&[transferId+seq], transferId',
      texts: '&id, createdAt, direction, favorite',
      settings: '&key',
    });
  }
}

export const db = new DropzoneDb();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await db.settings.get(key);
  return record ? (record.value as T) : fallback;
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function loadSettings(defaults: AppSettings): Promise<AppSettings> {
  const stored = await getSetting<Partial<AppSettings>>('app', {});
  return { ...defaults, ...stored, historyLimit: stored.historyLimit ?? DEFAULT_HISTORY_LIMIT };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await putSetting('app', settings);
}

export async function listDevices(): Promise<DeviceRecord[]> {
  return db.devices.orderBy('pairedAt').reverse().toArray();
}

export async function upsertDevice(device: DeviceRecord): Promise<void> {
  await db.devices.put(device);
}

export async function removeDevice(id: string): Promise<void> {
  await db.devices.delete(id);
}

export async function recentTransfers(limit = 20, options?: { favoriteOnly?: boolean }): Promise<TransferRecord[]> {
  let collection = db.transfers.orderBy('createdAt').reverse();
  const records = await collection.toArray();
  const filtered = options?.favoriteOnly ? records.filter((record) => record.favorite === 1) : records;
  return filtered.slice(0, limit);
}

export async function putTransfer(record: TransferRecord): Promise<void> {
  await db.transfers.put(record);
}

export async function patchTransfer(id: string, patch: Partial<TransferRecord>): Promise<void> {
  await db.transfers.update(id, patch);
}

export async function toggleFavorite(id: string): Promise<number> {
  const record = await db.transfers.get(id);
  const next = record?.favorite === 1 ? 0 : 1;
  await db.transfers.update(id, { favorite: next });
  return next;
}

export async function deleteTransfer(id: string): Promise<void> {
  await db.transaction('rw', db.transfers, db.files, db.chunks, async () => {
    await db.transfers.delete(id);
    await db.files.delete(id);
    await db.chunks.where('transferId').equals(id).delete();
  });
  const { dropSource } = await import('./opfs');
  await dropSource(id);
}

export async function clearTransfers(): Promise<void> {
  await db.transaction('rw', db.transfers, db.files, db.chunks, db.texts, async () => {
    await db.transfers.clear();
    await db.files.clear();
    await db.chunks.clear();
    await db.texts.clear();
  });
  // Leave no orphaned OPFS source copies behind after a wipe.
  const { pruneSources } = await import('./opfs');
  await pruneSources(new Set());
}

export async function saveFile(transferId: string, blob: Blob, size: number): Promise<void> {
  await db.files.put({ transferId, blob, createdAt: Date.now(), size });
}

export async function readFile(transferId: string): Promise<Blob | undefined> {
  const record = await db.files.get(transferId);
  return record?.blob;
}

export async function putText(record: TextRecord): Promise<void> {
  await db.texts.put(record);
}

export async function listTexts(limit = 50): Promise<TextRecord[]> {
  return db.texts.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function deleteText(id: string): Promise<void> {
  await db.texts.delete(id);
}

export async function pruneHistory(limit: number): Promise<number> {
  const all = await db.transfers.orderBy('createdAt').reverse().toArray();
  const keep = all.filter((record) => record.favorite === 1).concat(all.filter((record) => record.favorite === 0).slice(0, Math.max(limit, 1)));
  const keepIds = new Set(keep.map((record) => record.id));
  const remove = all.filter((record) => !keepIds.has(record.id));
  for (const record of remove) await deleteTransfer(record.id);
  return remove.length;
}

export async function storageUsage(): Promise<{ usage: number; quota: number; persisted: boolean }> {
  let usage = 0;
  let quota = 0;
  let persisted = false;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    /* storage estimation is best-effort */
  }
  return { usage, quota, persisted };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function exportSnapshot(): Promise<string> {
  const [devices, transfers, texts, settings] = await Promise.all([
    db.devices.toArray(),
    db.transfers.toArray(),
    db.texts.toArray(),
    db.settings.toArray(),
  ]);
  return JSON.stringify(
    {
      app: 'dropzone',
      version: 1,
      exportedAt: new Date().toISOString(),
      devices,
      transfers,
      texts,
      settings,
    },
    null,
    2,
  );
}