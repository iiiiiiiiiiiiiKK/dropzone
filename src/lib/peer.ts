import { BUFFERED_LOW_THRESHOLD } from './constants';
import { trace } from './log';
import type { SignalData } from './signaling';

export type LinkState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type LinkPath = 'direct' | 'relay' | 'unknown';

export type PeerEvents = {
  onState: (deviceId: string, state: LinkState, detail?: string) => void;
  onOpen: (deviceId: string) => void;
  onClose: (deviceId: string) => void;
  onMessage: (deviceId: string, data: ArrayBuffer) => void;
  onPath: (deviceId: string, path: LinkPath) => void;
  onError: (deviceId: string, message: string) => void;
};

const CHANNEL_LABEL = 'dropzone.v1';

type Link = {
  id: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  initiator: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  state: LinkState;
  drainers: Array<() => void>;
  remoteSet: boolean;
};

export class PeerMesh {
  private links = new Map<string, Link>();
  private iceServers: RTCIceServer[] = [];
  /** Candidates that arrive before their offer/answer created the peer connection. */
  private orphanCandidates = new Map<string, RTCIceCandidateInit[]>();

  constructor(
    private readonly options: {
      localId: string;
      sendSignal: (to: string, data: SignalData) => void;
      events: PeerEvents;
    },
  ) {}

  setIceServers(servers: RTCIceServer[]): void {
    this.iceServers = servers;
  }

  getLinkState(deviceId: string): LinkState {
    return this.links.get(deviceId)?.state ?? 'idle';
  }

  isOpen(deviceId: string): boolean {
    const link = this.links.get(deviceId);
    return link?.channel?.readyState === 'open';
  }

  listLinks(): Array<{ deviceId: string; state: LinkState }> {
    return Array.from(this.links.entries()).map(([deviceId, link]) => ({ deviceId, state: link.state }));
  }

  /** Returns an open data channel, establishing the connection when needed. */
  async ensure(deviceId: string): Promise<RTCDataChannel> {
    if (!deviceId) throw new Error('A target device is required');
    if (this.isOpen(deviceId)) return this.links.get(deviceId)!.channel!;
    const stale = this.links.get(deviceId);
    if (stale && (stale.pc.connectionState === 'failed' || stale.pc.connectionState === 'closed')) {
      this.close(deviceId);
    }
    // Whoever needs the channel offers, regardless of id ordering: a send can start
    // from either device. Simultaneous offers are resolved in handleSignal.
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const link = this.getOrCreateLink(deviceId, true);
      if (link.channel?.readyState === 'open') return link.channel;
      if (link.pc.signalingState === 'stable') {
        await this.negotiate(link);
      }
      try {
        return await this.waitForOpen(link, attempt === 0 ? 9_000 : 16_000);
      } catch (error) {
        lastError = error as Error;
        trace('peer', 'handshake attempt failed', deviceId.slice(0, 8), lastError.message);
        this.close(deviceId);
      }
    }
    throw lastError ?? new Error('Connection failed');
  }

  async handleSignal(from: string, data: SignalData): Promise<void> {
    trace('peer', 'signal', data.kind, 'from', from.slice(0, 8), 'links', this.links.size);
    if (data.kind === 'bye') {
      this.close(from);
      return;
    }
    if (data.kind === 'offer') {
      const link = this.getOrCreateLink(from, false);
      if (link.pc.signalingState !== 'stable') {
        // Glare: both sides offered. The lexicographically smaller id keeps its offer;
        // the larger one rolls back and answers.
        if (this.options.localId > from) {
          try {
            await link.pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
          } catch {
            this.close(from);
            return;
          }
        } else {
          trace('peer', 'glare: keeping local offer, ignoring remote', from.slice(0, 8));
          return;
        }
      }
      await link.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      link.remoteSet = true;
      await this.flushCandidates(link);
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      this.options.sendSignal(from, { kind: 'answer', sdp: answer.sdp ?? '' });
      return;
    }
    if (data.kind === 'answer') {
      const link = this.links.get(from);
      if (!link || link.pc.signalingState === 'stable') return;
      await link.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      link.remoteSet = true;
      await this.flushCandidates(link);
      return;
    }
    if (data.kind === 'candidate') {
      const link = this.links.get(from);
      if (!link) {
        const queue = this.orphanCandidates.get(from) ?? [];
        if (queue.length < 64) queue.push(data.candidate);
        this.orphanCandidates.set(from, queue);
        return;
      }
      if (!link.remoteSet) {
        link.pendingCandidates.push(data.candidate);
        return;
      }
      try {
        await link.pc.addIceCandidate(data.candidate);
      } catch {
        /* stale candidates after a renegotiation are expected */
      }
    }
  }

  send(deviceId: string, payload: ArrayBuffer | ArrayBufferView): boolean {
    const link = this.links.get(deviceId);
    const channel = link?.channel;
    if (!channel || channel.readyState !== 'open') return false;
    try {
      channel.send(payload as ArrayBuffer);
      return true;
    } catch (error) {
      this.options.events.onError(deviceId, (error as Error).message);
      return false;
    }
  }

  bufferedAmount(deviceId: string): number {
    return this.links.get(deviceId)?.channel?.bufferedAmount ?? 0;
  }

  waitForDrain(deviceId: string): Promise<void> {
    const link = this.links.get(deviceId);
    const channel = link?.channel;
    if (!channel || channel.readyState !== 'open') return Promise.resolve();
    if (channel.bufferedAmount <= BUFFERED_LOW_THRESHOLD) return Promise.resolve();
    return new Promise((resolve) => {
      link!.drainers.push(resolve);
    });
  }

  close(deviceId: string): void {
    const link = this.links.get(deviceId);
    if (!link) return;
    try {
      link.channel?.close();
      link.pc.close();
    } catch {
      /* already closed */
    }
    link.state = 'closed';
    this.links.delete(deviceId);
    this.orphanCandidates.delete(deviceId);
    link.drainers.forEach((resolve) => resolve());
    this.options.events.onState(deviceId, 'closed');
  }

  closeAll(): void {
    Array.from(this.links.keys()).forEach((deviceId) => this.close(deviceId));
  }

  private getOrCreateLink(deviceId: string, initiator: boolean): Link {
    const existing = this.links.get(deviceId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceCandidatePoolSize: 2, bundlePolicy: 'max-bundle' });
    const orphaned = this.orphanCandidates.get(deviceId);
    this.orphanCandidates.delete(deviceId);
    const link: Link = {
      id: deviceId,
      pc,
      channel: null,
      initiator,
      pendingCandidates: orphaned ? orphaned.splice(0, orphaned.length) : [],
      state: 'connecting',
      drainers: [],
      remoteSet: false,
    };
    this.links.set(deviceId, link);
    this.options.events.onState(deviceId, 'connecting');

    pc.onicecandidate = (event) => {
      if (event.candidate) this.options.sendSignal(deviceId, { kind: 'candidate', candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        link.state = 'connected';
        this.options.events.onState(deviceId, 'connected');
        void this.detectPath(link);
      } else if (state === 'disconnected') {
        link.state = 'disconnected';
        this.options.events.onState(deviceId, 'disconnected');
      } else if (state === 'failed') {
        link.state = 'failed';
        this.options.events.onState(deviceId, 'failed');
        this.close(deviceId);
      } else if (state === 'closed') {
        this.options.events.onState(deviceId, 'closed');
      }
    };
    pc.ondatachannel = (event) => this.attachChannel(link, event.channel);
    return link;
  }

  private async negotiate(link: Link): Promise<void> {
    const channel = link.pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
    this.attachChannel(link, channel);
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    trace('peer', 'offer ->', link.id.slice(0, 8), 'sdpLen', (offer.sdp ?? '').length);
    this.options.sendSignal(link.id, { kind: 'offer', sdp: offer.sdp ?? '' });
  }

  private attachChannel(link: Link, channel: RTCDataChannel): void {
    link.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFERED_LOW_THRESHOLD;
    channel.onopen = () => {
      link.state = 'connected';
      this.options.events.onOpen(link.id);
      this.options.events.onState(link.id, 'connected');
      void this.detectPath(link);
    };
    channel.onclose = () => {
      this.options.events.onClose(link.id);
      if (link.state !== 'closed') {
        link.state = 'disconnected';
        this.options.events.onState(link.id, 'disconnected');
      }
    };
    channel.onerror = (event) => {
      const message = (event as RTCErrorEvent).error?.message ?? 'Data channel error';
      this.options.events.onError(link.id, message);
    };
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.options.events.onMessage(link.id, event.data);
    };
    channel.onbufferedamountlow = () => {
      const pending = link.drainers.splice(0, link.drainers.length);
      pending.forEach((resolve) => resolve());
    };
  }

  private waitForOpen(link: Link, timeoutMs = 25_000): Promise<RTCDataChannel> {
    if (link.channel?.readyState === 'open') return Promise.resolve(link.channel);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timed out'));
      }, timeoutMs);
      const check = () => {
        if (link.channel?.readyState === 'open') {
          cleanup();
          resolve(link.channel);
        }
      };
      const onStateChange = () => {
        const state = link.pc.connectionState;
        if (state === 'failed' || state === 'closed') {
          cleanup();
          reject(new Error('Connection failed'));
        }
      };
      const interval = setInterval(check, 200);
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(interval);
        link.pc.removeEventListener('connectionstatechange', onStateChange);
      };
      link.pc.addEventListener('connectionstatechange', onStateChange);
      check();
    });
  }

  private async flushCandidates(link: Link): Promise<void> {
    const pending = link.pendingCandidates.splice(0, link.pendingCandidates.length);
    for (const candidate of pending) {
      try {
        await link.pc.addIceCandidate(candidate);
      } catch {
        /* ignore stale candidate */
      }
    }
  }

  private async detectPath(link: Link): Promise<void> {
    try {
      const stats = await link.pc.getStats();
      let relay = false;
      let direct = false;
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && (report as RTCIceCandidatePairStats).state === 'succeeded') {
          const local = stats.get((report as RTCIceCandidatePairStats).localCandidateId ?? '');
          const remote = stats.get((report as RTCIceCandidatePairStats).remoteCandidateId ?? '');
          const localType = (local as { candidateType?: string } | undefined)?.candidateType;
          const remoteType = (remote as { candidateType?: string } | undefined)?.candidateType;
          if (localType === 'relay' || remoteType === 'relay') relay = true;
          else if (localType || remoteType) direct = true;
        }
      });
      this.options.events.onPath(link.id, relay ? 'relay' : direct ? 'direct' : 'unknown');
    } catch {
      this.options.events.onPath(link.id, 'unknown');
    }
  }
}

export function buildIceServers(ice: { stun: string[]; turn: { urls: string[]; username: string; credential: string } | null } | null): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  if (ice?.stun?.length) servers.push({ urls: ice.stun });
  if (ice?.turn?.urls?.length) {
    servers.push({ urls: ice.turn.urls, username: ice.turn.username, credential: ice.turn.credential });
  }
  return servers;
}
