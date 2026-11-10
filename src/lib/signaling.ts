import type { Identity } from './device';
import { MAX_SIGNAL_FRAME } from './constants';
import { trace } from './log';

export type PeerInfo = {
  id: string;
  name: string;
  type: string;
  publicKey?: string;
  online: boolean;
  lastSeen?: number;
};

export type TurnConfig = { urls: string[]; username: string; credential: string; ttl: number } | null;
export type RelayIce = { stun: string[]; turn: TurnConfig };

export type RelayState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline' | 'error';

export type SignalData =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  | { kind: 'bye'; reason?: string };

export type RelayHandlers = {
  onState?: (state: RelayState, detail?: string) => void;
  onReady?: (payload: { ice: RelayIce; peers: PeerInfo[]; maxFrameBytes: number }) => void;
  onPeers?: (peers: PeerInfo[]) => void;
  onPaired?: (peer: PeerInfo) => void;
  onSignal?: (from: string, data: SignalData) => void;
  onError?: (code: string, message: string) => void;
};

type Outgoing =
  | { t: 'hello'; v: 1; device: { id: string; name: string; type: string; publicKey: string }; pairToken?: string }
  | { t: 'presence'; device: { name: string; type: string } }
  | { t: 'invite'; tokenHash: string; expiresAt: number }
  | { t: 'signal'; to: string; data: SignalData }
  | { t: 'ping' };

const HEARTBEAT_MS = 20_000;
const MAX_BACKOFF_MS = 20_000;
/** A socket that stops answering pings is dead even if the browser has not noticed. */
const MAX_MISSED_PONGS = 2;

export class RelayClient {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private manualClose = false;
  private state: RelayState = 'idle';
  private queued: string[] = [];
  private missedPongs = 0;
  private lastPongAt = 0;

  constructor(
    private readonly options: {
      url: string;
      identity: Identity;
      deviceName: string;
      deviceType: string;
      pairToken?: string;
      handlers: RelayHandlers;
    },
  ) {}

  get currentState(): RelayState {
    return this.state;
  }

  get lastSeenPongAt(): number {
    return this.lastPongAt;
  }

  private setState(state: RelayState, detail?: string): void {
    this.state = state;
    this.options.handlers.onState?.(state, detail);
  }

  connect(): void {
    if (!this.options.url) {
      this.setState('offline', 'No signaling endpoint configured');
      return;
    }
    this.manualClose = false;
    this.setState(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url);
    } catch (error) {
      this.setState('error', (error as Error).message);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.send({
        t: 'hello',
        v: 1,
        device: {
          id: this.options.identity.deviceId,
          name: this.options.deviceName,
          type: this.options.deviceType,
          publicKey: this.options.identity.publicKey,
        },
        ...(this.options.pairToken ? { pairToken: this.options.pairToken } : {}),
      });
      this.startHeartbeat();
      // Anything queued while the socket was down is delivered right after hello,
      // so an offer created during a reconnect is never lost.
      this.flushQueue();
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = () => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.manualClose) {
        this.setState('idle');
        return;
      }
      this.setState('offline', 'Relay connection closed');
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (this.state !== 'online') this.setState('error', 'Relay unreachable');
    };
  }

  disconnect(): void {
    this.manualClose = true;
    this.stopHeartbeat();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.queued = [];
    this.setState('idle');
  }

  updatePresence(deviceName: string, deviceType: string): void {
    this.send({ t: 'presence', device: { name: deviceName, type: deviceType } });
  }

  registerInvite(tokenHash: string, expiresAt: number): void {
    this.send({ t: 'invite', tokenHash, expiresAt });
  }

  sendSignal(to: string, data: SignalData): void {
    this.send({ t: 'signal', to, data });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;
    this.lastPongAt = Date.now();
    this.heartbeat = setInterval(() => {
      if (this.missedPongs > MAX_MISSED_PONGS) {
        // The relay stopped answering — force a reconnect instead of pretending to be online.
        this.stopHeartbeat();
        try {
          this.socket?.close(4000, 'heartbeat timeout');
        } catch {
          /* already closed */
        }
        this.socket = null;
        this.setState('reconnecting', 'Heartbeat lost');
        this.scheduleReconnect();
        return;
      }
      this.missedPongs += 1;
      this.send({ t: 'ping' });
    }, HEARTBEAT_MS);
  }

  /** Brings the socket back immediately, e.g. when a phone wakes from sleep. */
  ensureConnected(): void {
    if (this.manualClose) return;
    if (this.state === 'online' && this.socket?.readyState === WebSocket.OPEN) return;
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING)) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.connect();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    this.attempts += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 800 * 2 ** Math.min(this.attempts, 5));
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private send(message: Outgoing): void {
    const payload = JSON.stringify(message);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (message.t === 'invite' || message.t === 'signal') this.queued.push(payload);
      return;
    }
    if (payload.length > MAX_SIGNAL_FRAME) {
      this.options.handlers.onError?.('frame_too_large', 'Signaling message exceeds the relay limit');
      return;
    }
    this.socket.send(payload);
    trace('relay', '->', message.t, message.t === 'signal' ? (message as { to: string }).to.slice(0, 8) : '');
    this.flushQueue();
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.queued.length === 0) return;
    const pending = this.queued.splice(0, this.queued.length);
    pending.forEach((entry) => this.socket?.send(entry));
    trace('relay', 'flushed', pending.length, 'queued frames');
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    if (raw.length > MAX_SIGNAL_FRAME) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const handlers = this.options.handlers;
    trace('relay', '<-', String(message.t), message.t === 'signal' ? String(message.from).slice(0, 8) : '');
    switch (message.t) {
      case 'pong':
        this.missedPongs = 0;
        this.lastPongAt = Date.now();
        return;
      case 'ready': {
        const ice = (message.ice ?? { stun: [], turn: null }) as RelayIce;
        const peers = Array.isArray(message.peers) ? (message.peers as PeerInfo[]) : [];
        this.setState('online');
        handlers.onReady?.({ ice, peers, maxFrameBytes: Number(message.limits ?? MAX_SIGNAL_FRAME) });
        return;
      }
      case 'peers':
        handlers.onPeers?.(Array.isArray(message.peers) ? (message.peers as PeerInfo[]) : []);
        return;
      case 'paired':
        if (message.peer) handlers.onPaired?.(message.peer as PeerInfo);
        return;
      case 'signal':
        if (typeof message.from === 'string' && message.data) {
          handlers.onSignal?.(message.from, message.data as SignalData);
        }
        return;
      case 'error':
        handlers.onError?.(String(message.code ?? 'error'), String(message.message ?? 'Relay error'));
        return;
      default:
        return;
    }
  }
}
