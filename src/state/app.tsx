import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_HISTORY_LIMIT,
  PAIRING_TTL_MS,
  resolveConfig,
  type AppSettings,
  type ThemeMode,
} from '../lib/constants';
import {
  clearTransfers,
  db,
  deleteTransfer,
  listDevices,
  loadSettings,
  patchTransfer,
  pruneHistory,
  putTransfer,
  recentTransfers,
  removeDevice,
  saveSettings,
  upsertDevice,
  type DeviceRecord,
  type TextRecord,
  type TransferRecord,
} from '../lib/db';
import { createIdentity, defaultDeviceName, detectDeviceType, safetyNumber, type DeviceType, type Identity } from '../lib/device';
import { buildIceServers, PeerMesh, type LinkPath, type LinkState } from '../lib/peer';
import { createInviteToken, hashToken, type PairInvite } from '../lib/pairing';
import { RelayClient, type PeerInfo, type RelayIce, type RelayState } from '../lib/signaling';
import { TransferEngine, type TransferProgress } from '../lib/transfer';
import { buildPreview } from '../lib/clipboard';
import { useToasts } from '../components/Toasts';
import { setLanguage, t } from '../lib/i18n';
import { trace } from '../lib/log';
import { reconcileInterruptedTransfers } from '../lib/resume';
import { isImageMime, randomId } from '../lib/utils';
import { useTheme } from '../lib/theme';

export type QueueItem = {
  id: string;
  file: File;
  previewUrl?: string;
  width?: number;
  height?: number;
  isImage: boolean;
};

type AppContextValue = {
  ready: boolean;
  identity: Identity | null;
  deviceType: DeviceType;
  settings: AppSettings;
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  relayState: RelayState;
  relayDetail: string;
  signalUrl: string;
  turnConfigured: boolean;
  peers: PeerInfo[];
  devices: DeviceRecord[];
  transfers: TransferRecord[];
  texts: TextRecord[];
  progress: Record<string, TransferProgress>;
  linkStates: Record<string, LinkState>;
  paths: Record<string, LinkPath>;
  verified: Record<string, boolean>;
  /** Relay roster OR an actually open link — a stale roster must not read as offline. */
  isOnline: (deviceId: string) => boolean;
  queue: QueueItem[];
  inbox: Array<{ transferId: string; name: string; mime: string; at: number }>;
  dismissInbox: (transferId: string) => void;
  incoming: { deviceId: string; deviceName: string; name: string; size: number } | null;
  answerIncoming: (accepted: boolean) => void;
  pairToken: string | undefined;
  addFiles: (files: File[]) => Promise<void>;
  removeQueued: (id: string) => void;
  clearQueue: () => void;
  sendQueued: (deviceId: string) => Promise<void>;
  sendFilesTo: (deviceId: string, files: File[]) => Promise<void>;
  sendTextTo: (deviceId: string, body: string) => Promise<void>;
  startInvite: () => Promise<PairInvite>;
  pairWithInvite: (invite: PairInvite) => Promise<void>;
  unpair: (deviceId: string) => Promise<void>;
  renamePaired: (deviceId: string, name: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
  refreshTransfers: () => Promise<void>;
  toggleFavoriteTransfer: (id: string) => Promise<void>;
  removeTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => void;
  clearHistory: () => Promise<void>;
  reconnectRelay: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

const DEFAULT_SETTINGS: AppSettings = {
  deviceName: '',
  deviceType: 'desktop',
  theme: 'dark',
  language: 'en',
  autoReceive: true,
  notifications: false,
  historyLimit: DEFAULT_HISTORY_LIMIT,
  signalUrlOverride: '',
};

type StoredIdentity = { deviceId: string; publicKey: string; privateKey: CryptoKey };

export function AppProvider({ children }: { children: ReactNode }) {
  const toasts = useToasts();
  const [theme, setTheme] = useTheme();
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [relayState, setRelayState] = useState<RelayState>('idle');
  const [relayDetail, setRelayDetail] = useState('');
  const [ice, setIce] = useState<RelayIce>({ stun: [], turn: null });
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [texts, setTexts] = useState<TextRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, TransferProgress>>({});
  const [linkStates, setLinkStates] = useState<Record<string, LinkState>>({});
  const [paths, setPaths] = useState<Record<string, LinkPath>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [session, setSession] = useState<{ key: number; pairToken?: string }>({ key: 0 });
  const [inbox, setInbox] = useState<Array<{ transferId: string; name: string; mime: string; at: number }>>([]);
  const [incoming, setIncoming] = useState<{
    deviceId: string;
    deviceName: string;
    name: string;
    size: number;
    resolve: (accepted: boolean) => void;
  } | null>(null);

  const relayRef = useRef<RelayClient | null>(null);
  const meshRef = useRef<PeerMesh | null>(null);
  const engineRef = useRef<TransferEngine | null>(null);
  const identityRef = useRef<Identity | null>(null);
  const settingsRef = useRef(settings);
  const devicesRef = useRef<DeviceRecord[]>([]);
  const pairTokenRef = useRef<string | undefined>(undefined);
  const peersRef = useRef<PeerInfo[]>([]);
  const config = useMemo(() => resolveConfig(), []);
  const deviceType = useMemo<DeviceType>(() => detectDeviceType(), []);

  identityRef.current = identity;
  settingsRef.current = settings;
  devicesRef.current = devices;
  peersRef.current = peers;

  const signalUrl = settings.signalUrlOverride.trim() || config.signalUrl || '';

  /* ---------- bootstrap ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await db.settings.get('identity');
      let nextIdentity: Identity | null = null;
      const saved = stored?.value as StoredIdentity | undefined;
      if (saved?.deviceId && saved.publicKey && saved.privateKey) {
        nextIdentity = { deviceId: saved.deviceId, publicKey: saved.publicKey, privateKey: saved.privateKey };
      } else {
        nextIdentity = await createIdentity();
        await db.settings.put({ key: 'identity', value: nextIdentity });
      }
      const loadedSettings = await loadSettings({
        ...DEFAULT_SETTINGS,
        deviceName: defaultDeviceName(detectDeviceType()),
        deviceType: detectDeviceType(),
      });
      // A record still marked transferring at boot belongs to a page that is gone.
      // Marking it interrupted makes it eligible for the OPFS/indexedDB resume pass.
      await reconcileInterruptedTransfers();
      const [deviceList, transferList] = await Promise.all([listDevices(), recentTransfers(loadedSettings.historyLimit)]);
      const textList = await db.texts.orderBy('createdAt').reverse().limit(50).toArray();
      if (cancelled) return;
      setLanguage(loadedSettings.language === 'zh' ? 'zh' : 'en');
      setIdentity(nextIdentity);
      setSettings(loadedSettings);
      setDevices(deviceList);
      setTransfers(transferList);
      setTexts(textList);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- settings persistence ---------- */
  useEffect(() => {
    if (!ready) return;
    if (settings.theme !== theme) setTheme(settings.theme);
  }, [settings.theme, ready, theme, setTheme]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    if (patch.language) setLanguage(patch.language);
    setSettings((current) => {
      const next = { ...current, ...patch };
      void saveSettings(next);
      settingsRef.current = next;
      return next;
    });
  }, []);

  const refreshDevices = useCallback(async () => {
    const list = await listDevices();
    setDevices(list);
  }, []);

  const refreshTransfers = useCallback(async () => {
    const list = await recentTransfers(500);
    setTransfers(list);
  }, []);

  const mergePeer = useCallback(
    async (peer: PeerInfo) => {
      if (!peer?.id) return;
      const existing = await db.devices.get(peer.id);
      const record: DeviceRecord = {
        id: peer.id,
        name: peer.name || existing?.name || 'Device',
        type: peer.type || existing?.type || 'desktop',
        publicKey: peer.publicKey || existing?.publicKey || '',
        pairedAt: existing?.pairedAt ?? Date.now(),
        lastSeen: Date.now(),
      };
      if (record.publicKey && identityRef.current) {
        record.safetyNumber = await safetyNumber(identityRef.current.publicKey, record.publicKey);
      }
      await upsertDevice(record);
      await refreshDevices();
    },
    [refreshDevices],
  );

  const refreshDevicesRef = useRef(mergePeer);
  refreshDevicesRef.current = mergePeer;

  /* ---------- peer mesh + transfer engine ---------- */
  useEffect(() => {
    if (!identity) return;
    const mesh = new PeerMesh({
      localId: identity.deviceId,
      sendSignal: (to, data) => relayRef.current?.sendSignal(to, data),
      events: {
        onState: (deviceId, state) => setLinkStates((current) => ({ ...current, [deviceId]: state })),
        onOpen: (deviceId) => {
          setLinkStates((current) => ({ ...current, [deviceId]: 'connected' }));
          engineRef.current?.greet(deviceId);
          // Reload-resume: an interrupted outgoing transfer resumes as soon as the
          // peer is reachable again, without the user hunting for a retry button.
          void engineRef.current?.resumeOutgoing(deviceId).then((resumedId) => {
            if (resumedId) toasts.push({ tone: 'info', title: t('toast.resumed'), body: t('toast.resumedBody') });
          });
          // The other side of the same coin: if WE were receiving when the link died,
          // ask the peer to continue instead of waiting for a manual retry.
          void engineRef.current?.requestResume(deviceId);
        },
        onClose: (deviceId) => setLinkStates((current) => ({ ...current, [deviceId]: 'disconnected' })),
        onMessage: (deviceId, data) => {
          void engineRef.current?.handleMessage(deviceId, data);
        },
        onPath: (deviceId, path) => setPaths((current) => ({ ...current, [deviceId]: path })),
        onError: (deviceId, message) => {
          toasts.push({ tone: 'error', title: t('notice.error'), body: message });
          setLinkStates((current) => ({ ...current, [deviceId]: 'failed' }));
        },
      },
    });
    const engine = new TransferEngine({
      identity,
      mesh,
      events: {
        onProgress: (update) => setProgress((current) => ({ ...current, [update.id]: update })),
        onRecord: (record) => {
          setTransfers((current) => {
            const next = current.filter((entry) => entry.id !== record.id);
            return [record, ...next].sort((a, b) => b.createdAt - a.createdAt);
          });
          void pruneHistory(settingsRef.current.historyLimit);
        },
        onText: (record) => setTexts((current) => [record, ...current.filter((entry) => entry.id !== record.id)].slice(0, 100)),
        onIncomingReady: (transferId, name, mime) => {
          setInbox((current) => [{ transferId, name, mime, at: Date.now() }, ...current.filter((item) => item.transferId !== transferId)].slice(0, 6));
        },
        onNotice: (notice) => {
          toasts.push({
            tone: notice.level,
            title: notice.title,
            body: notice.body,
          });
          if (settingsRef.current.notifications && 'Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(notice.title, { body: notice.body, tag: notice.title });
            } catch {
              /* notification failures are non-fatal */
            }
          }
        },
        onPeerVerified: (deviceId, ok) => setVerified((current) => ({ ...current, [deviceId]: ok })),
        resolveDeviceName: (deviceId) =>
          devicesRef.current.find((device) => device.id === deviceId)?.name ??
          peersRef.current.find((peer) => peer.id === deviceId)?.name ??
          'Paired device',
        autoAccept: () => settingsRef.current.autoReceive,
        requestAccept: (deviceId, name, size) =>
          new Promise<boolean>((resolve) => {
            setIncoming({
              deviceId,
              name,
              size,
              deviceName:
                devicesRef.current.find((device) => device.id === deviceId)?.name ??
                peersRef.current.find((peer) => peer.id === deviceId)?.name ??
                t('common.unknownDevice'),
              resolve,
            });
          }),
      },
    });
    meshRef.current = mesh;
    engineRef.current = engine;
    return () => {
      mesh.closeAll();
      meshRef.current = null;
      engineRef.current = null;
    };
  }, [identity, toasts]);

  /* ---------- relay ---------- */
  useEffect(() => {
    if (!identity) return;
    pairTokenRef.current = session.pairToken;
    const relay = new RelayClient({
      url: signalUrl,
      identity,
      deviceName: settingsRef.current.deviceName || defaultDeviceName(deviceType),
      deviceType,
      pairToken: session.pairToken,
      handlers: {
        onState: (state, detail) => {
          setRelayState(state);
          setRelayDetail(detail ?? '');
        },
        onReady: (payload) => {
          setIce(payload.ice);
          setPeers(payload.peers);
          meshRef.current?.setIceServers(buildIceServers(payload.ice));
          payload.peers.forEach((peer) => void refreshDevicesRef.current(peer));
        },
        onPeers: (list) => {
          setPeers(list);
          list.forEach((peer) => void refreshDevicesRef.current(peer));
          // A reloaded tab has interrupted transfers but no live channel: open one
          // to each resumable peer so resumeOutgoing() can pick the work back up.
          void resumePendingTransfers(list.filter((peer) => peer.online).map((peer) => peer.id));
        },
        onPaired: (peer) => {
          pairTokenRef.current = undefined;
          void refreshDevicesRef.current(peer);
          toasts.push({ tone: 'success', title: t('toast.pairedTitle', { name: peer.name }), body: t('toast.pairedBody') });
        },
        onSignal: (from, data) => {
          void meshRef.current?.handleSignal(from, data);
        },
        onError: (code, message) => {
          if (['pair_unknown', 'pair_expired', 'pair_used', 'pair_self', 'not_paired'].includes(code)) {
            toasts.push({ tone: 'warn', title: t('toast.pairProblem'), body: message });
          }
        },
      },
    });
    relayRef.current = relay;
    relay.connect();
    return () => {
      relay.disconnect();
      relayRef.current = null;
    };
  }, [identity, signalUrl, deviceType, session.key, session.pairToken, toasts]);


  const reconnectRelay = useCallback(() => {
    setSession((current) => ({ key: current.key + 1, pairToken: pairTokenRef.current }));
  }, []);

  const resumeAttempted = useRef<Set<string>>(new Set());

  const resumePendingTransfers = useCallback(async (deviceIds: string[]) => {
    const engine = engineRef.current;
    if (!engine) return;
    const pending = await db.transfers.where('status').equals('interrupted').toArray();
    const resumable = pending.filter((record) => record.direction === 'out' && record.opfsStored);
    if (resumable.length === 0) return;
    for (const deviceId of deviceIds) {
      const forPeer = resumable.filter((record) => record.deviceId === deviceId);
      if (forPeer.length === 0) continue;
      // One attempt per peer per page load; a second failure must not loop.
      if (resumeAttempted.current.has(deviceId)) continue;
      resumeAttempted.current.add(deviceId);
      try {
        await meshRef.current?.ensure(deviceId);
        // resumeOutgoing picks the record itself; loop so several pending files drain.
        for (let i = 0; i < forPeer.length; i += 1) {
          const resumedId = await engine.resumeOutgoing(deviceId);
          if (!resumedId) break;
          toasts.push({ tone: 'info', title: t('toast.resumed'), body: t('toast.resumedBody') });
        }
      } catch (error) {
        trace('transfer', 'resume after reload failed', (error as Error).message);
      }
    }
  }, [toasts]);

  /* ---------- presence refresh ---------- */
  // Presence is only pushed on connect/disconnect, so a peer that slept without a
  // clean close would stay "offline" here. Re-announcing periodically forces the
  // relay to re-broadcast the roster to every paired device.
  useEffect(() => {
    if (!identity) return;
    const announce = () => {
      if (document.visibilityState === 'hidden') return;
      relayRef.current?.updatePresence(
        settingsRef.current.deviceName || defaultDeviceName(deviceType),
        deviceType,
      );
    };
    const timer = setInterval(announce, 30_000);
    return () => clearInterval(timer);
  }, [identity, deviceType]);

  /* ---------- network awareness ---------- */
  useEffect(() => {
    const onOnline = () => {
      relayRef.current?.ensureConnected();
      reconnectRelay();
    };
    const onOffline = () => setRelayState('offline');
    // Phones freeze timers in the background; on wake the socket may be dead without
    // a close event, so re-check liveness and re-establish the relay immediately.
    const onWake = () => {
      if (document.visibilityState === 'hidden') return;
      relayRef.current?.ensureConnected();
      const lastPong = relayRef.current?.lastSeenPongAt ?? 0;
      if (relayRef.current?.currentState !== 'online' || Date.now() - lastPong > 45_000) {
        reconnectRelay();
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
    };
  }, []);

  /* ---------- queue ---------- */
  const addFiles = useCallback(async (files: File[]) => {
    const items: QueueItem[] = [];
    for (const file of files) {
      const preview = isImageMime(file.type) ? await buildPreview(file) : null;
      items.push({
        id: randomId(9),
        file,
        previewUrl: preview?.url,
        width: preview?.width,
        height: preview?.height,
        isImage: isImageMime(file.type),
      });
    }
    setQueue((current) => [...current, ...items]);
  }, []);

  const removeQueued = useCallback((id: string) => {
    setQueue((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue((current) => {
      current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, []);

  const waitForRelay = useCallback(async (timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (relayRef.current?.currentState === 'online') return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return relayRef.current?.currentState === 'online';
  }, []);

  const sendQueued = useCallback(
    async (deviceId: string) => {
      const items = queue;
      if (!deviceId) {
        toasts.push({ tone: 'warn', title: t('toast.noDeviceTitle'), body: t('toast.noDeviceBody') });
        return;
      }
      if (items.length === 0) return;
      clearQueue();
      await waitForRelay();
      await engineRef.current?.sendFiles(
        deviceId,
        items.map((item) => item.file),
      );
    },
    [queue, clearQueue, toasts, waitForRelay],
  );

  const sendFilesTo = useCallback(
    async (deviceId: string, files: File[]) => {
      if (!deviceId) {
        toasts.push({ tone: 'warn', title: t('toast.noDeviceTitle'), body: t('toast.noDeviceBody') });
        return;
      }
      if (files.length === 0) return;
      const online = await waitForRelay();
      if (!online) toasts.push({ tone: 'warn', title: t('toast.relayOfflineTitle'), body: t('toast.relayOfflineBody') });
      await engineRef.current?.sendFiles(deviceId, files);
    },
    [toasts, waitForRelay],
  );

  const sendTextTo = useCallback(
    async (deviceId: string, body: string) => {
      if (!deviceId) {
        toasts.push({ tone: 'warn', title: t('toast.noDeviceTitle'), body: t('toast.noDeviceBody') });
        return;
      }
      try {
        await engineRef.current?.sendText(deviceId, body);
        toasts.push({ tone: 'success', title: t('toast.textSent'), body: t('toast.textSentBody') });
      } catch (error) {
        toasts.push({ tone: 'error', title: t('toast.textFailed'), body: (error as Error).message });
      }
    },
    [toasts],
  );

  /* ---------- pairing ---------- */
  const startInvite = useCallback(async (): Promise<PairInvite> => {
    const current = identityRef.current;
    if (!current) throw new Error('Device identity is not ready');
    const token = createInviteToken();
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    const tokenHash = await hashToken(token);
    relayRef.current?.registerInvite(tokenHash, expiresAt);
    return {
      deviceId: current.deviceId,
      publicKey: current.publicKey,
      name: settingsRef.current.deviceName || defaultDeviceName(deviceType),
      token,
      expiresAt,
    };
  }, [deviceType]);

  const pairWithInvite = useCallback(
    async (invite: PairInvite) => {
      const existing = await db.devices.get(invite.deviceId);
      const record: DeviceRecord = {
        id: invite.deviceId,
        name: invite.name,
        type: existing?.type ?? 'desktop',
        publicKey: invite.publicKey,
        pairedAt: existing?.pairedAt ?? Date.now(),
        lastSeen: Date.now(),
      };
      if (identityRef.current) record.safetyNumber = await safetyNumber(identityRef.current.publicKey, invite.publicKey);
      await upsertDevice(record);
      await refreshDevices();
      setSession((current) => ({ key: current.key + 1, pairToken: invite.token }));
      toasts.push({ tone: 'info', title: t('toast.pairing', { name: invite.name }), body: t('toast.pairingBody') });
    },
    [refreshDevices, toasts],
  );

  const unpair = useCallback(
    async (deviceId: string) => {
      await removeDevice(deviceId);
      meshRef.current?.close(deviceId);
      await refreshDevices();
      toasts.push({ tone: 'info', title: t('toast.unpaired'), body: t('toast.unpairedBody') });
    },
    [refreshDevices, toasts],
  );

  const renamePaired = useCallback(
    async (deviceId: string, name: string) => {
      const existing = await db.devices.get(deviceId);
      if (!existing) return;
      await upsertDevice({ ...existing, name });
      await refreshDevices();
    },
    [refreshDevices],
  );

  const toggleFavoriteTransfer = useCallback(
    async (id: string) => {
      const record = await db.transfers.get(id);
      if (!record) return;
      await patchTransfer(id, { favorite: record.favorite === 1 ? 0 : 1 });
      await refreshTransfers();
    },
    [refreshTransfers],
  );

  const removeTransfer = useCallback(
    async (id: string) => {
      await deleteTransfer(id);
      setTransfers((current) => current.filter((entry) => entry.id !== id));
    },
    [],
  );

  const clearHistory = useCallback(async () => {
    await clearTransfers();
    setTransfers([]);
    setTexts([]);
    setProgress({});
    setInbox([]);
    toasts.push({ tone: 'info', title: t('toast.cleared') });
  }, [toasts]);

  const answerIncoming = useCallback(
    (accepted: boolean) => {
      setIncoming((current) => {
        current?.resolve(accepted);
        return null;
      });
    },
    [],
  );

  const dismissInbox = useCallback((transferId: string) => {
    setInbox((current) => current.filter((item) => item.transferId !== transferId));
  }, []);

  const cancelTransfer = useCallback((id: string) => {
    engineRef.current?.cancel(id);
    toasts.push({ tone: 'info', title: t('toast.canceled') });
  }, [toasts]);

  /* ---------- keep-awake + leave guard while transferring ---------- */
  const activeCount = Object.values(progress).filter(
    (entry) => entry.phase === 'sending' || entry.phase === 'receiving' || entry.phase === 'hashing' || entry.phase === 'verifying',
  ).length;

  useEffect(() => {
    if (activeCount === 0) return;
    let released = false;
    let sentinel: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock?.request) {
      nav.wakeLock
        .request('screen')
        .then((lock) => {
          if (released) void lock.release();
          else sentinel = lock;
        })
        .catch(() => undefined);
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = t('xfer.leaveGuard');
      return t('xfer.leaveGuard');
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      released = true;
      void sentinel?.release().catch(() => undefined);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [activeCount]);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      identity,
      deviceType,
      settings,
      theme,
      setTheme: (mode) => {
        setTheme(mode);
        void updateSettings({ theme: mode });
      },
      updateSettings,
      relayState,
      relayDetail,
      signalUrl,
      turnConfigured: Boolean(ice.turn),
      peers,
      devices,
      transfers,
      texts,
      progress,
      linkStates,
      paths,
      verified,
      isOnline: (deviceId: string) =>
        linkStates[deviceId] === 'connected' || peers.some((peer) => peer.id === deviceId && peer.online),
      queue,
      inbox,
      dismissInbox,
      incoming: incoming ? { deviceId: incoming.deviceId, deviceName: incoming.deviceName, name: incoming.name, size: incoming.size } : null,
      answerIncoming,
      pairToken: session.pairToken,
      addFiles,
      removeQueued,
      clearQueue,
      sendQueued,
      sendFilesTo,
      sendTextTo,
      startInvite,
      pairWithInvite,
      unpair,
      renamePaired,
      refreshDevices,
      refreshTransfers,
      toggleFavoriteTransfer,
      removeTransfer,
      cancelTransfer,
      clearHistory,
      reconnectRelay,
    }),
    [
      ready,
      identity,
      deviceType,
      settings,
      theme,
      setTheme,
      updateSettings,
      relayState,
      relayDetail,
      signalUrl,
      ice.turn,
      peers,
      devices,
      transfers,
      texts,
      progress,
      linkStates,
      paths,
      verified,
      queue,
      inbox,
      dismissInbox,
      incoming,
      answerIncoming,
      session.pairToken,
      addFiles,
      removeQueued,
      clearQueue,
      sendQueued,
      sendFilesTo,
      sendTextTo,
      startInvite,
      pairWithInvite,
      unpair,
      renamePaired,
      refreshDevices,
      refreshTransfers,
      toggleFavoriteTransfer,
      removeTransfer,
      cancelTransfer,
      clearHistory,
      reconnectRelay,
    ],
  );

  // Read-only diagnostic hook: lets E2E tests and curious users inspect the live
  // relay/WebRTC state without opening devtools. It never mutates anything.
  useEffect(() => {
    const debug = () => ({
      relay: relayRef.current?.currentState ?? 'idle',
      signalUrl,
      ice: { stun: ice.stun.length, turn: Boolean(ice.turn), turnUrls: ice.turn?.urls.length ?? 0 },
      peers: peersRef.current,
      devices: devicesRef.current.map((device) => ({ id: device.id, name: device.name })),
      links: meshRef.current?.listLinks() ?? [],
      transfers: transfers.map((record) => ({ id: record.id, name: record.name, status: record.status, direction: record.direction, error: record.error })),
    });
    void ice;
    (window as unknown as { __DROPZONE_DEBUG__?: () => unknown }).__DROPZONE_DEBUG__ = debug;
    // Test-only surface, enabled by ?debug=1: lets an automated run sever a live
    // link to prove that automatic retry and resume actually recover.
    if (new URLSearchParams(window.location.search).has('debug')) {
      (window as unknown as { __DROPZONE_TEST__?: unknown }).__DROPZONE_TEST__ = {
        closeLink: (deviceId: string) => meshRef.current?.close(deviceId),
      };
    }
    return () => {
      delete (window as unknown as { __DROPZONE_DEBUG__?: () => unknown }).__DROPZONE_DEBUG__;
    };
  }, [signalUrl, transfers, ice]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export async function persistTransfer(record: TransferRecord): Promise<void> {
  await putTransfer(record);
}