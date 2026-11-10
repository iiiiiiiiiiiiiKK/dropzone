import { isImageMime, safeFileName } from './utils';

export type IngestResult = {
  files: File[];
  text: string;
  source: 'paste' | 'drop' | 'picker' | 'camera' | 'share';
};

function renameImage(file: File): File {
  if (file.name && file.name !== 'image.png' && file.name !== 'blob') return file;
  const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type, lastModified: Date.now() });
}

export function filesFromDataTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  if (transfer.items && transfer.items.length > 0) {
    for (const item of Array.from(transfer.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(renameImage(file));
    }
  }
  if (files.length === 0 && transfer.files) {
    for (const file of Array.from(transfer.files)) files.push(renameImage(file));
  }
  return files;
}

export function ingestClipboardEvent(event: ClipboardEvent): IngestResult {
  const files: File[] = [];
  const data = event.clipboardData;
  let text = '';
  if (data) {
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(renameImage(file));
      }
    }
    if (files.length === 0 && data.files?.length) {
      for (const file of Array.from(data.files)) files.push(renameImage(file));
    }
    if (files.length === 0) text = data.getData('text/plain') ?? '';
  }
  return { files, text, source: 'paste' };
}

export async function readClipboardDirect(): Promise<IngestResult> {
  const files: File[] = [];
  let text = '';
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          files.push(renameImage(new File([blob], 'clipboard-image', { type: imageType })));
          continue;
        }
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          text = await blob.text();
        }
      }
    } else if (navigator.clipboard?.readText) {
      text = await navigator.clipboard.readText();
    }
  } catch (error) {
    return { files, text, source: 'paste' };
  }
  return { files, text, source: 'paste' };
}

export type PreviewInfo = { url: string; width: number; height: number; thumbnail?: Blob };

export async function buildPreview(file: File): Promise<PreviewInfo | null> {
  if (!isImageMime(file.type)) return null;
  const url = URL.createObjectURL(file);
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, 640 / Math.max(width, height));
    let thumbnail: Blob | undefined;
    if (scale < 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        thumbnail = await new Promise<Blob | undefined>((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/webp', 0.82));
      }
    }
    bitmap.close();
    return { url, width, height, thumbnail };
  } catch {
    return { url, width: 0, height: 0 };
  }
}

export function pickFiles(options: { accept?: string; multiple?: boolean; capture?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = options.multiple ?? true;
    if (options.accept) input.accept = options.accept;
    if (options.capture && 'capture' in input) input.setAttribute('capture', 'environment');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files.map((file) => renameImage(file)));
    };
    input.onchange = () => finish(Array.from(input.files ?? []));
    input.oncancel = () => finish([]);
    input.click();
  });
}

export function filesToNamed(file: File): File {
  return renameImage(file);
}

export function clipboardSupport(): { pasteEvent: boolean; asyncRead: boolean } {
  return {
    pasteEvent: typeof document !== 'undefined',
    asyncRead: typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.read),
  };
}

export { safeFileName };
