export type RuntimeConfig = {
  signalUrl?: string;
  stunUrls?: string[];
};

declare global {
  interface Window {
    __DROPZONE_CONFIG__?: RuntimeConfig;
  }
}

const buildEnv = (import.meta.env ?? {}) as Record<string, string | undefined>;

function normalizeUrl(input: string | undefined): string | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  return value;
}

/**
 * Resolution order: runtime config.js -> build-time env -> same-origin /ws path.
 * The last fallback keeps self-hosting simple: serve the SPA and the relay from one host.
 */
export function resolveConfig(): RuntimeConfig {
  const runtime = typeof window !== 'undefined' ? window.__DROPZONE_CONFIG__ : undefined;
  const signalUrl = normalizeUrl(runtime?.signalUrl) ?? normalizeUrl(buildEnv.VITE_SIGNAL_URL) ?? defaultSignalUrl();
  const stunFromEnv = normalizeUrl(buildEnv.VITE_STUN_URLS);
  const stunUrls =
    runtime?.stunUrls && runtime.stunUrls.length > 0
      ? runtime.stunUrls
      : stunFromEnv
        ? stunFromEnv.split(',').map((entry) => entry.trim()).filter(Boolean)
        : DEFAULT_STUN;
  return { signalUrl, stunUrls };
}

function defaultSignalUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  if (!isHttp) return undefined;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws`;
}

export const DEFAULT_STUN: string[] = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];

export const STORAGE_KEYS = {
  theme: 'dropzone.theme',
  deviceId: 'dropzone.deviceId',
  identity: 'dropzone.identity',
  settings: 'dropzone.settings',
  historyLimit: 'dropzone.historyLimit',
} as const;

export const DEFAULT_HISTORY_LIMIT = 100;
export const MAX_SIGNAL_FRAME = 32 * 1024;
export const CHUNK_SIZE = 64 * 1024;
export const MIN_CHUNK_SIZE = 16 * 1024;
export const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024;
export const BUFFERED_LOW_THRESHOLD = 1024 * 1024;
export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const APP_VERSION = '1.0.0';
export const AUTHOR_X_URL = 'https://x.com/0xkillcoin';
export const REPO_URL = 'https://github.com/iiiiiiiiiiiiiKK/dropzone';

export type ThemeMode = 'dark' | 'light';

export type AppSettings = {
  deviceName: string;
  deviceType: string;
  theme: ThemeMode;
  language: 'en' | 'zh';
  autoReceive: boolean;
  notifications: boolean;
  historyLimit: number;
  signalUrlOverride: string;
};
