export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : digits)} ${units[index]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function randomId(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toBase64Url(buffer);
}

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'doc' | 'sheet' | 'slide' | 'code' | 'text' | 'file';

export function fileKind(name: string, mime = ''): FileKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'heic', 'bmp', 'psd'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'archive';
  if (['doc', 'docx', 'rtf', 'odt', 'pages'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'slide';
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'sh', 'yml', 'yaml', 'toml'].includes(ext)) return 'code';
  if (['txt', 'md', 'log'].includes(ext) || mime.startsWith('text/')) return 'text';
  return 'file';
}

export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'untitled').slice(0, 180);
}

export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|webp|gif|avif|bmp|svg\+xml)$/i.test(mime);
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delay = 250): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
