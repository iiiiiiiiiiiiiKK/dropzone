/**
 * DROPZONE signaling — Cloudflare Workers variant (protocol v1).
 *
 * One Durable Object class ('Relay') holds every WebSocket for the single relay
 * instance 'relay-main' and speaks exactly the same protocol, /health, /turn and
 * /config.json surface as server/index.mjs.
 *
 * WebSockets use the Hibernation API (state.acceptWebSocket / webSocketMessage /
 * webSocketClose), so idle sockets do not burn duration. Per-connection identity
 * lives in the WebSocket attachment; pairing invitations and pair links live in
 * Durable Object storage so they survive hibernation and redeploys.
 *
 * Plain .mjs, no build step: wrangler deploy --config workers/signaling/wrangler.toml
 */
const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 32 * 1024;
const SIGNAL_KINDS = ['offer', 'answer', 'candidate', 'bye'];
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:@-]{4,128}$/;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RATE_WINDOW_MS = 10000;
const RATE_MAX = 60;
const HELLO_TIMEOUT_MS = 10000;
const MAX_PAIRS_PER_DEVICE = 64;
const RELAY_NAME = 'relay-main';
const CONSUMED_INVITE_TTL_MS = 15 * 60 * 1000;

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {}),
  });
}
function splitList(value, fallback) {
  if (value === undefined || value === null) return (fallback || []).slice();
  const items = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : (fallback || []).slice();
}
function envInt(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function hex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
function truncate(value, limit) {
  const text = value === undefined || value === null ? '' : String(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

function allowedOrigins(env) {
  return splitList(env.ALLOWED_ORIGINS, []);
}
function isOriginAllowed(env, origin) {
  const origins = allowedOrigins(env);
  if (!origins.length) return true;
  return typeof origin === 'string' && origins.includes(origin);
}
function corsHeaders(env, origin) {
  const origins = allowedOrigins(env);
  if (!origin) return {};
  if (origins.length && !origins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

function stunList(env) {
  return splitList(env.STUN_URLS, ['stun:stun.l.google.com:19302']);
}

/** Protocol 1.4 — coturn static-auth-secret REST credentials, identical math to the Node server. */
async function turnCredentials(env, deviceId) {
  const urls = splitList(env.TURN_URLS, []);
  const secret = env.TURN_SECRET ? String(env.TURN_SECRET).trim() : '';
  if (!secret || !urls.length) return null;
  const ttl = clamp(envInt(env.TURN_TTL_SECONDS, 3600), 60, 86400);
  const prefix = env.TURN_USERNAME_PREFIX ? String(env.TURN_USERNAME_PREFIX) : '';
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = prefix + expiry + ':' + deviceId;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
  return { urls, username, credential: base64(signature), ttl };
}

function signalUrlFor(request) {
  const url = new URL(request.url);
  const scheme = url.protocol === 'https:' ? 'wss' : 'ws';
  return scheme + '://' + url.host + '/ws';
}

function relayStub(env) {
  return env.RELAY.get(env.RELAY.idFromName(RELAY_NAME));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }
    if (url.pathname === '/turn') {
      const credentials = await turnCredentials(env, '');
      if (!credentials) return jsonResponse(null, 200, corsHeaders(env, origin));
      const device = url.searchParams.get('device');
      if (!device || !DEVICE_ID_PATTERN.test(device)) {
        return jsonResponse({ error: 'device_required' }, 400, corsHeaders(env, origin));
      }
      return jsonResponse(await turnCredentials(env, device), 200, corsHeaders(env, origin));
    }
    if (url.pathname === '/config.json') {
      const configured = Boolean((env.TURN_SECRET || '').trim() && splitList(env.TURN_URLS, []).length);
      return jsonResponse(
        { signalUrl: signalUrlFor(request), rtc: { stun: stunList(env), turnConfigured: configured } },
        200,
        corsHeaders(env, origin),
      );
    }
    if (url.pathname === '/health') {
      return relayStub(env).fetch(new Request('https://relay.internal/health', { method: 'GET' }));
    }
    if (url.pathname === '/ws') {
      if (!isOriginAllowed(env, origin)) {
        return jsonResponse({ error: 'forbidden', reason: 'origin_mismatch' }, 403, corsHeaders(env, origin));
      }
      const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
      if (upgrade !== 'websocket') {
        return jsonResponse({ error: 'upgrade_required' }, 426, corsHeaders(env, origin));
      }
      return relayStub(env).fetch(request);
    }
    return jsonResponse({ error: 'not_found' }, 404, corsHeaders(env, origin));
  },
};

export class Relay {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.links = new Map();
    this.devices = new Map();
    this.pairedCount = null;
    this.startedAt = Date.now();
  }

  attachmentOf(ws) {
    try {
      return ws.deserializeAttachment() || null;
    } catch {
      return null;
    }
  }

  liveSockets() {
    try {
      return this.state.getWebSockets();
    } catch {
      return [];
    }
  }

  async pairedTotal() {
    if (this.pairedCount !== null) return this.pairedCount;
    const stored = await this.state.storage.get('stats:paired');
    this.pairedCount = Number.isFinite(stored) ? stored : 0;
    return this.pairedCount;
  }

  async healthBody() {
    let clients = 0;
    for (const ws of this.liveSockets()) {
      const attachment = this.attachmentOf(ws);
      if (attachment && attachment.helloed) clients += 1;
    }
    return {
      status: 'ok',
      service: 'dropzone-signaling',
      clients,
      paired: await this.pairedTotal(),
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return jsonResponse(await this.healthBody());
    if (url.pathname !== '/ws') return jsonResponse({ error: 'not_found' }, 404);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return jsonResponse({ error: 'upgrade_required' }, 426);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const cid = crypto.randomUUID();
    server.serializeAttachment({ cid, id: '', helloed: false, name: '', type: 'unknown', publicKey: '' });
    this.state.acceptWebSocket(server);
    const session = this.newSession(cid);
    this.sessions.set(cid, session);
    session.helloTimer = setTimeout(() => {
      if (session.helloed) return;
      try {
        server.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'hello timeout' }));
        server.close(1008, 'hello timeout');
      } catch {}
    }, HELLO_TIMEOUT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  newSession(cid) {
    return {
      cid,
      ws: null,
      id: '',
      name: '',
      type: 'unknown',
      publicKey: '',
      helloed: false,
      windowStart: Date.now(),
      windowCount: 0,
      helloTimer: null,
    };
  }

  sessionFor(ws) {
    const attachment = this.attachmentOf(ws) || {};
    const cid = attachment.cid || 'anon';
    let session = this.sessions.get(cid);
    if (!session) {
      session = this.newSession(cid);
      session.id = attachment.id || '';
      session.name = attachment.name || '';
      session.type = attachment.type || 'unknown';
      session.publicKey = attachment.publicKey || '';
      session.helloed = Boolean(attachment.helloed);
      this.sessions.set(cid, session);
    }
    session.ws = ws;
    return session;
  }

  persistAttachment(session) {
    if (!session.ws) return;
    try {
      session.ws.serializeAttachment({
        cid: session.cid,
        id: session.id,
        helloed: session.helloed,
        name: session.name,
        type: session.type,
        publicKey: session.publicKey,
      });
    } catch {}
  }

  sendTo(id, payload) {
    const frame = JSON.stringify(payload);
    for (const ws of this.liveSockets()) {
      const attachment = this.attachmentOf(ws);
      if (!attachment || attachment.id !== id || !attachment.helloed) continue;
      try {
        ws.send(frame);
      } catch {}
    }
  }

  isOnline(id) {
    for (const ws of this.liveSockets()) {
      const attachment = this.attachmentOf(ws);
      if (attachment && attachment.id === id && attachment.helloed) return true;
    }
    return false;
  }

  async deviceMeta(id) {
    if (this.devices.has(id)) return this.devices.get(id);
    const stored = await this.state.storage.get('dev:' + id);
    const meta = stored && typeof stored === 'object' ? stored : { name: '', type: 'unknown', publicKey: '', lastSeen: 0 };
    this.devices.set(id, meta);
    return meta;
  }

  async rememberDevice(id, patch) {
    const meta = Object.assign({}, await this.deviceMeta(id), patch, { lastSeen: Date.now() });
    this.devices.set(id, meta);
    await this.state.storage.put('dev:' + id, meta);
    return meta;
  }

  async linksFor(id) {
    if (this.links.has(id)) return this.links.get(id);
    const stored = await this.state.storage.get('links:' + id);
    const set = new Set(Array.isArray(stored) ? stored : []);
    this.links.set(id, set);
    return set;
  }

  async pairCount() {
    let total = 0;
    const keys = await this.state.storage.list({ prefix: 'links:' });
    for (const value of keys.values()) {
      if (Array.isArray(value)) total += value.length;
    }
    this.pairedCount = Math.floor(total / 2);
    return this.pairedCount;
  }

  async addPair(a, b) {
    for (const [owner, peer] of [[a, b], [b, a]]) {
      const set = new Set(await this.linksFor(owner));
      if (set.size >= MAX_PAIRS_PER_DEVICE && !set.has(peer)) continue;
      set.add(peer);
      this.links.set(owner, set);
      await this.state.storage.put('links:' + owner, [...set]);
    }
    await this.pairCount();
    await this.state.storage.put('stats:paired', this.pairedCount);
  }

  async peerSnapshot(id) {
    const meta = await this.deviceMeta(id);
    return {
      id,
      name: meta.name || '',
      type: meta.type || 'unknown',
      publicKey: meta.publicKey || '',
      online: this.isOnline(id),
      lastSeen: meta.lastSeen || 0,
    };
  }

  async rosterFor(id) {
    const peers = await this.linksFor(id);
    const rows = [];
    for (const peerId of peers) rows.push(await this.peerSnapshot(peerId));
    return rows;
  }

  async emitPeers(id) {
    if (!this.isOnline(id)) return;
    this.sendTo(id, { t: 'peers', peers: await this.rosterFor(id) });
  }

  async broadcastPresence(id) {
    await this.emitPeers(id);
    const peers = await this.linksFor(id);
    for (const peerId of peers) await this.emitPeers(peerId);
  }

  async handleInvite(session, message) {
    const tokenHash = typeof message.tokenHash === 'string' ? message.tokenHash.trim().toLowerCase() : '';
    if (!TOKEN_HASH_PATTERN.test(tokenHash)) {
      this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'invite requires tokenHash (hex sha256 of the pairing token)' });
      return;
    }
    if (await this.state.storage.get('invite:' + tokenHash)) {
      this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'invite tokenHash already registered' });
      return;
    }
    if (await this.state.storage.get('used:' + tokenHash)) {
      this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'invite tokenHash already registered' });
      return;
    }
    const now = Date.now();
    const ttlMs = clamp(envInt(this.env.PAIRING_TTL_SECONDS, 300), 60, 900) * 1000;
    const requested = Number(message.expiresAt);
    const expiresAt = Number.isFinite(requested) && requested > now ? Math.min(requested, now + ttlMs) : now + ttlMs;
    await this.state.storage.put('invite:' + tokenHash, { owner: session.id, expiresAt });
  }

  async consumePairToken(session, pairToken) {
    if (typeof pairToken !== 'string' || pairToken.length < 8 || pairToken.length > 512) return 'bad_message';
    const now = Date.now();
    const tokenHash = await sha256Hex(pairToken);
    const invite = await this.state.storage.get('invite:' + tokenHash);
    if (!invite) return (await this.state.storage.get('used:' + tokenHash)) ? 'pair_used' : 'pair_unknown';
    if (Number(invite.expiresAt) <= now) {
      await this.state.storage.delete('invite:' + tokenHash);
      return 'pair_expired';
    }
    if (invite.owner === session.id) {
      await this.state.storage.delete('invite:' + tokenHash);
      return 'pair_self';
    }
    if (!this.isOnline(invite.owner)) return 'pair_not_online';
    await this.state.storage.delete('invite:' + tokenHash);
    await this.state.storage.put('used:' + tokenHash, now);
    await this.addPair(session.id, invite.owner);
    this.sendTo(invite.owner, { t: 'paired', peer: await this.peerSnapshot(session.id) });
    this.sendTo(session.id, { t: 'paired', peer: await this.peerSnapshot(invite.owner) });
    await this.broadcastPresence(session.id);
    await this.broadcastPresence(invite.owner);
    return null;
  }

  async handleHello(session, message) {
    const device = message.device;
    if (!device || typeof device !== 'object' || Array.isArray(device)) {
      this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'hello requires device { id, name, type, publicKey }' });
      session.ws.close(1008, 'hello requires device');
      return;
    }
    const id = typeof device.id === 'string' ? device.id.trim() : '';
    if (!DEVICE_ID_PATTERN.test(id)) {
      try {
        session.ws.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'device.id is not a valid identifier' }));
        session.ws.close(1008, 'invalid device id');
      } catch {}
      return;
    }
    const declared = message.v === undefined ? PROTOCOL_VERSION : Number(message.v);
    if (declared !== PROTOCOL_VERSION) {
      try {
        session.ws.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'unsupported protocol version' }));
        session.ws.close(1008, 'unsupported protocol version');
      } catch {}
      return;
    }
    for (const other of this.liveSockets()) {
      if (other === session.ws) continue;
      const attachment = this.attachmentOf(other);
      if (attachment && attachment.id === id && attachment.helloed) {
        try {
          other.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'replaced by a newer connection' }));
          other.close(1008, 'replaced by a newer connection');
        } catch {}
      }
    }
    session.id = id;
    session.name = typeof device.name === 'string' ? truncate(device.name, 64) : '';
    session.type = typeof device.type === 'string' ? truncate(device.type, 32) : 'unknown';
    session.publicKey = typeof device.publicKey === 'string' ? truncate(device.publicKey, 512) : '';
    session.helloed = true;
    if (session.helloTimer) {
      clearTimeout(session.helloTimer);
      session.helloTimer = null;
    }
    this.persistAttachment(session);
    await this.rememberDevice(id, { name: session.name, type: session.type, publicKey: session.publicKey });
    const ready = {
      t: 'ready',
      v: PROTOCOL_VERSION,
      self: { id },
      ice: { stun: stunList(this.env), turn: await turnCredentials(this.env, id) },
      peers: await this.rosterFor(id),
      limits: { maxFrameBytes: MAX_FRAME_BYTES },
    };
    try {
      session.ws.send(JSON.stringify(ready));
    } catch {}
    if (typeof message.pairToken === 'string' && message.pairToken) {
      const code = await this.consumePairToken(session, message.pairToken);
      if (code) {
        const messages = {
          bad_message: 'pairToken is malformed',
          pair_unknown: 'no such pairing invitation',
          pair_expired: 'pairing invitation expired',
          pair_used: 'pairing invitation already used',
          pair_self: 'a device cannot pair with itself',
          pair_not_online: 'the inviting device is not online',
        };
        this.sendTo(id, { t: 'error', code, message: messages[code] || 'pairing failed' });
      }
    }
    await this.broadcastPresence(id);
  }

  async handleSignal(session, message) {
    const to = typeof message.to === 'string' ? message.to : '';
    const data = message.data;
    if (!to) {
      this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'signal requires a target device id' });
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !SIGNAL_KINDS.includes(data.kind)) {
      this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'signal.data.kind must be offer, answer, candidate or bye' });
      return;
    }
    const links = await this.linksFor(session.id);
    if (!links.has(to)) {
      this.sendTo(session.id, { t: 'error', code: 'not_paired', message: 'this device pair is not authorized for signaling' });
      return;
    }
    if (!this.isOnline(to)) {
      this.sendTo(session.id, { t: 'error', code: 'peer_offline', message: 'paired peer is not connected' });
      return;
    }
    this.sendTo(to, { t: 'signal', from: session.id, data });
  }

  async webSocketMessage(ws, message) {
    const session = this.sessionFor(ws);
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const byteLength = typeof message === 'string' ? new TextEncoder().encode(message).length : message.byteLength || 0;
    const now = Date.now();
    if (byteLength > MAX_FRAME_BYTES) {
      try {
        ws.send(JSON.stringify({ t: 'error', code: 'frame_too_large', message: 'frame exceeds ' + MAX_FRAME_BYTES + ' bytes' }));
        ws.close(1009, 'frame too large');
      } catch {}
      return;
    }
    if (now - session.windowStart >= RATE_WINDOW_MS) {
      session.windowStart = now;
      session.windowCount = 0;
    }
    session.windowCount += 1;
    if (session.windowCount > RATE_MAX) {
      try {
        ws.send(JSON.stringify({ t: 'error', code: 'rate_limited', message: 'no more than 60 messages per 10 s' }));
        ws.close(1008, 'rate limited');
      } catch {}
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      try {
        ws.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'frame is not valid JSON' }));
        if (!session.helloed) ws.close(1008, 'invalid hello');
      } catch {}
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.t !== 'string') {
      try {
        ws.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'frame requires a string t field' }));
        if (!session.helloed) ws.close(1008, 'invalid hello');
      } catch {}
      return;
    }
    try {
      if (!session.helloed) {
        if (payload.t !== 'hello') {
          ws.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'hello must be the first frame' }));
          ws.close(1008, 'invalid hello');
          return;
        }
        await this.handleHello(session, payload);
        return;
      }
      switch (payload.t) {
        case 'hello':
          this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'already registered' });
          return;
        case 'presence': {
          const device = payload.device || {};
          if (typeof device.name === 'string') session.name = truncate(device.name, 64);
          if (typeof device.type === 'string') session.type = truncate(device.type, 32);
          this.persistAttachment(session);
          await this.rememberDevice(session.id, { name: session.name, type: session.type, publicKey: session.publicKey });
          await this.broadcastPresence(session.id);
          return;
        }
        case 'invite':
          await this.handleInvite(session, payload);
          return;
        case 'signal':
          await this.handleSignal(session, payload);
          return;
        case 'ping':
          this.sendTo(session.id, { t: 'pong', ts: now });
          return;
        default:
          this.sendTo(session.id, { t: 'error', code: 'bad_message', message: 'unknown message type: ' + truncate(payload.t, 32) });
      }
    } catch (error) {
      try {
        ws.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'internal handler failure' }));
      } catch {}
      console.error('relay_handler_failure', error && error.message ? error.message : String(error));
    }
  }

  async webSocketClose(ws, code, reason) {
    const attachment = this.attachmentOf(ws);
    const cid = attachment && attachment.cid ? attachment.cid : null;
    const session = cid ? this.sessions.get(cid) : null;
    const deviceId = (attachment && attachment.id) || (session && session.id) || '';
    if (session && session.helloTimer) {
      clearTimeout(session.helloTimer);
      session.helloTimer = null;
    }
    if (cid) this.sessions.delete(cid);
    if (!deviceId) return;
    await this.rememberDevice(deviceId, {});
    await this.broadcastPresence(deviceId);
    console.log(JSON.stringify({ level: 'info', event: 'disconnect', device: deviceId, code }));
  }

  async webSocketError(ws, error) {
    console.log(JSON.stringify({ level: 'warn', event: 'socket_error', message: truncate(error && error.message, 200) }));
  }
}
