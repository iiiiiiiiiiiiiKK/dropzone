/**
 * DROPZONE signaling service — protocol v1 (see docs/protocol.md).
 *
 * Node >= 20, ESM, single runtime dependency: ws.
 * The relay only ever sees small JSON control frames. It never receives, stores,
 * logs or forwards file bytes, file names or file content.
 *
 * Endpoints
 *   GET  /health      -> { status, service, clients, paired, uptime }
 *   GET  /turn        -> coturn REST credentials (protocol 1.4) or null
 *   GET  /config.json -> { signalUrl, rtc: { stun, turnConfigured } }
 *   WSS  /ws          -> signaling protocol v1
 */
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_CEILING = 32 * 1024;
const SIGNAL_KINDS = ['offer', 'answer', 'candidate', 'bye'];
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:@-]{4,128}$/;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const MAX_PAIRS_PER_DEVICE = 64;
const MAX_DEVICE_RECORDS = 10000;
const CONSUMED_INVITE_TTL_MS = 15 * 60 * 1000;

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}
function envList(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback.slice();
  const items = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback.slice();
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function truncate(value, limit) {
  const text = value === undefined || value === null ? '' : String(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

const config = {
  port: envInt('PORT', 8787),
  host: process.env.HOST && process.env.HOST.trim() ? process.env.HOST.trim() : '0.0.0.0',
  origins: envList('ALLOWED_ORIGINS', []),
  maxClients: clamp(envInt('MAX_CLIENTS', 1000), 1, 100000),
  maxFrameBytes: clamp(envInt('MAX_SIGNAL_BYTES', MAX_FRAME_CEILING), 1024, MAX_FRAME_CEILING),
  pairingTtlMs: clamp(envInt('PAIRING_TTL_SECONDS', 300), 60, 900) * 1000,
  helloTimeoutMs: clamp(envInt('HELLO_TIMEOUT_MS', 10000), 200, 60000),
  rateWindowMs: 10000,
  rateMax: 60,
  stun: envList('STUN_URLS', ['stun:stun.l.google.com:19302']),
  turnUrls: envList('TURN_URLS', []),
  turnSecret: process.env.TURN_SECRET && process.env.TURN_SECRET.trim() ? process.env.TURN_SECRET.trim() : '',
  turnTtlSec: clamp(envInt('TURN_TTL_SECONDS', 3600), 60, 86400),
  publicUrl: process.env.SIGNAL_PUBLIC_URL && process.env.SIGNAL_PUBLIC_URL.trim() ? process.env.SIGNAL_PUBLIC_URL.trim() : '',
  logLevel: LOG_LEVELS[process.env.LOG_LEVEL] === undefined ? 'info' : process.env.LOG_LEVEL,
};
const turnConfigured = Boolean(config.turnSecret && config.turnUrls.length);
const startedAt = Date.now();

/** deviceId -> live session */
const sessions = new Map();
/** deviceId -> { name, type, publicKey, lastSeen } (survives disconnect, memory only) */
const devices = new Map();
/** deviceId -> Set<peerId> — durable pairing mesh (survives disconnect, memory only) */
const pairLinks = new Map();
/** sha256(token) hex -> { owner, expiresAt } pending single-use invitations */
const invites = new Map();
/** sha256(token) hex -> consumedAt, so replays answer pair_used instead of pair_unknown */
const consumedInvites = new Map();

function log(level, event, fields) {
  if (LOG_LEVELS[level] > LOG_LEVELS[config.logLevel]) return;
  const record = Object.assign({ ts: new Date().toISOString(), level, event }, fields || {});
  process.stdout.write(JSON.stringify(record) + '\n');
}

function sendJson(response, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  const headers = Object.assign(
    {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    },
    extraHeaders || {},
  );
  response.writeHead(status, headers);
  response.end(payload);
}

function corsHeaders(origin) {
  if (!origin) return {};
  if (config.origins.length && !config.origins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

function isOriginAllowed(origin) {
  if (!config.origins.length) return true;
  return typeof origin === 'string' && config.origins.includes(origin);
}

/** Protocol 1.4 — coturn static-auth-secret REST credentials. */
function turnCredentials(deviceId) {
  if (!turnConfigured) return null;
  const ttl = config.turnTtlSec;
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = String(expiry) + ':' + deviceId;
  const credential = createHmac('sha1', config.turnSecret).update(username, 'utf8').digest('base64');
  return { urls: config.turnUrls.slice(), username, credential, ttl };
}

function signalUrlFor(request) {
  if (config.publicUrl) return config.publicUrl;
  const forwarded = request.headers['x-forwarded-proto'];
  const proto = typeof forwarded === 'string' && forwarded.split(',')[0].trim() === 'https'
    ? 'https'
    : request.socket && request.socket.encrypted
      ? 'https'
      : 'http';
  const host = request.headers['x-forwarded-host'] || request.headers.host || ('127.0.0.1:' + config.port);
  return (proto === 'https' ? 'wss' : 'ws') + '://' + host + '/ws';
}

function countPairs() {
  let total = 0;
  for (const peers of pairLinks.values()) total += peers.size;
  return Math.floor(total / 2);
}

const httpServer = createServer((request, response) => {
  let url;
  try {
    url = new URL(request.url || '/', 'http://localhost');
  } catch {
    sendJson(response, 400, { error: 'bad_request' });
    return;
  }
  const extra = corsHeaders(request.headers.origin);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, extra);
    response.end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method_not_allowed' }, extra);
    return;
  }
  if (url.pathname === '/health') {
    sendJson(
      response,
      200,
      {
        status: 'ok',
        service: 'dropzone-signaling',
        clients: sessions.size,
        paired: countPairs(),
        uptime: Math.round((Date.now() - startedAt) / 1000),
      },
      extra,
    );
    return;
  }
  if (url.pathname === '/turn') {
    if (!turnConfigured) {
      sendJson(response, 200, null, extra);
      return;
    }
    const device = url.searchParams.get('device');
    if (!device || !DEVICE_ID_PATTERN.test(device)) {
      sendJson(response, 400, { error: 'device_required' }, extra);
      return;
    }
    sendJson(response, 200, turnCredentials(device), extra);
    return;
  }
  if (url.pathname === '/config.json') {
    sendJson(
      response,
      200,
      { signalUrl: signalUrlFor(request), rtc: { stun: config.stun.slice(), turnConfigured } },
      extra,
    );
    return;
  }
  sendJson(response, 404, { error: 'not_found' }, extra);
});

const wss = new WebSocketServer({
  noServer: true,
  clientTracking: false,
  perMessageDeflate: false,
  maxPayload: config.maxFrameBytes,
});

function rejectUpgrade(socket, status, phrase) {
  try {
    socket.write('HTTP/1.1 ' + status + ' ' + phrase + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  } catch {}
  socket.destroy();
}

httpServer.on('upgrade', (request, socket, head) => {
  let url;
  try {
    url = new URL(request.url || '/', 'http://localhost');
  } catch {
    rejectUpgrade(socket, 400, 'Bad Request');
    return;
  }
  if (url.pathname !== '/ws') {
    rejectUpgrade(socket, 404, 'Not Found');
    return;
  }
  if (!isOriginAllowed(request.headers.origin)) {
    log('warn', 'upgrade_rejected', { reason: 'origin', origin: truncate(request.headers.origin, 120) });
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }
  if (sessions.size >= config.maxClients) {
    log('warn', 'upgrade_rejected', { reason: 'capacity', clients: sessions.size });
    rejectUpgrade(socket, 503, 'Service Unavailable');
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function sendError(socket, code, message) {
  send(socket, { t: 'error', code, message });
}

function rememberDevice(id, patch) {
  const existing = devices.get(id) || { name: '', type: 'unknown', publicKey: '', lastSeen: 0 };
  const next = Object.assign({}, existing, patch || {}, { lastSeen: Date.now() });
  devices.set(id, next);
  if (devices.size > MAX_DEVICE_RECORDS) {
    const oldest = [...devices.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, Math.floor(MAX_DEVICE_RECORDS / 10));
    for (const [key] of oldest) {
      if (!sessions.has(key)) devices.delete(key);
    }
  }
  return next;
}

function isOnline(id) {
  const session = sessions.get(id);
  return Boolean(session && session.helloed && session.socket.readyState === WebSocket.OPEN);
}

function peerSnapshot(id) {
  const meta = devices.get(id) || { name: '', type: 'unknown', publicKey: '', lastSeen: 0 };
  return {
    id,
    name: meta.name || '',
    type: meta.type || 'unknown',
    publicKey: meta.publicKey || '',
    online: isOnline(id),
    lastSeen: meta.lastSeen || 0,
  };
}

function rosterFor(id) {
  const peers = pairLinks.get(id);
  if (!peers || !peers.size) return [];
  return [...peers].map((peerId) => peerSnapshot(peerId));
}

function addPair(a, b) {
  for (const [owner, peer] of [[a, b], [b, a]]) {
    let set = pairLinks.get(owner);
    if (!set) {
      set = new Set();
      pairLinks.set(owner, set);
    }
    if (set.size >= MAX_PAIRS_PER_DEVICE) {
      log('warn', 'pair_cap_reached', { device: owner });
      continue;
    }
    set.add(peer);
  }
}

function emitPeers(id) {
  const session = sessions.get(id);
  if (!session || !session.helloed) return;
  send(session.socket, { t: 'peers', peers: rosterFor(id) });
}

/** Presence fan-out: every paired peer of deviceId (and the device itself) gets a fresh roster. */
function broadcastPresence(deviceId) {
  emitPeers(deviceId);
  const peers = pairLinks.get(deviceId);
  if (!peers) return;
  for (const peerId of peers) emitPeers(peerId);
}

function pruneInvites(now) {
  for (const [hash, invite] of invites) {
    if (invite.expiresAt <= now) invites.delete(hash);
  }
  for (const [hash, consumedAt] of consumedInvites) {
    if (now - consumedAt > CONSUMED_INVITE_TTL_MS) consumedInvites.delete(hash);
  }
}

function handleInvite(session, socket, message, now) {
  const tokenHash = typeof message.tokenHash === 'string' ? message.tokenHash.trim().toLowerCase() : '';
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) {
    sendError(socket, 'bad_message', 'invite requires tokenHash (hex sha256 of the pairing token)');
    return;
  }
  if (invites.has(tokenHash) || consumedInvites.has(tokenHash)) {
    sendError(socket, 'bad_message', 'invite tokenHash already registered');
    return;
  }
  const requested = Number(message.expiresAt);
  const ceiling = now + config.pairingTtlMs;
  const expiresAt = Number.isFinite(requested) && requested > now ? Math.min(requested, ceiling) : ceiling;
  invites.set(tokenHash, { owner: session.id, expiresAt, issuedAt: now });
  log('info', 'invite_registered', { device: session.id, ttlMs: expiresAt - now });
}

/** Resolve a pairToken from hello. Returns null on success, otherwise the error code. */
function consumePairToken(session, socket, pairToken, now) {
  if (typeof pairToken !== 'string' || pairToken.length < 8 || pairToken.length > 512) {
    return 'bad_message';
  }
  const tokenHash = sha256Hex(pairToken);
  const invite = invites.get(tokenHash);
  if (!invite) {
    return consumedInvites.has(tokenHash) ? 'pair_used' : 'pair_unknown';
  }
  if (invite.expiresAt <= now) {
    invites.delete(tokenHash);
    return 'pair_expired';
  }
  if (invite.owner === session.id) {
    invites.delete(tokenHash);
    return 'pair_self';
  }
  if (!isOnline(invite.owner)) {
    // The invitation stays valid: the owner may reconnect inside its TTL.
    return 'pair_not_online';
  }
  invites.delete(tokenHash);
  consumedInvites.set(tokenHash, now);
  addPair(session.id, invite.owner);
  const ownerSession = sessions.get(invite.owner);
  const selfPeer = peerSnapshot(session.id);
  const ownerPeer = peerSnapshot(invite.owner);
  if (ownerSession) send(ownerSession.socket, { t: 'paired', peer: selfPeer });
  send(socket, { t: 'paired', peer: ownerPeer });
  broadcastPresence(session.id);
  broadcastPresence(invite.owner);
  log('info', 'paired', { a: session.id, b: invite.owner });
  return null;
}

function handleSignal(session, socket, message) {
  const to = typeof message.to === 'string' ? message.to : '';
  const data = message.data;
  if (!to) {
    sendError(socket, 'bad_message', 'signal requires a target device id');
    return;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !SIGNAL_KINDS.includes(data.kind)) {
    sendError(socket, 'bad_message', 'signal.data.kind must be offer, answer, candidate or bye');
    return;
  }
  const links = pairLinks.get(session.id);
  if (!links || !links.has(to)) {
    sendError(socket, 'not_paired', 'this device pair is not authorized for signaling');
    log('warn', 'signal_rejected', { from: session.id, to, reason: 'not_paired' });
    return;
  }
  const target = sessions.get(to);
  if (!target || !target.helloed || target.socket.readyState !== WebSocket.OPEN) {
    sendError(socket, 'peer_offline', 'paired peer is not connected');
    return;
  }
  send(target.socket, { t: 'signal', from: session.id, data });
}

function handleHello(session, socket, message, now) {
  const device = message.device;
  if (!device || typeof device !== 'object' || Array.isArray(device)) {
    sendError(socket, 'bad_message', 'hello requires device { id, name, type, publicKey }');
    socket.close(1008, 'hello requires device');
    return;
  }
  const id = typeof device.id === 'string' ? device.id.trim() : '';
  if (!DEVICE_ID_PATTERN.test(id)) {
    sendError(socket, 'bad_message', 'device.id is not a valid identifier');
    socket.close(1008, 'invalid device id');
    return;
  }
  const declaredVersion = message.v === undefined ? PROTOCOL_VERSION : Number(message.v);
  if (declaredVersion !== PROTOCOL_VERSION) {
    sendError(socket, 'bad_message', 'unsupported protocol version');
    socket.close(1008, 'unsupported protocol version');
    return;
  }
  if (sessions.has(id) && sessions.get(id).socket !== socket) {
    const previous = sessions.get(id);
    log('info', 'session_replaced', { device: id });
    previous.helloed = false;
    sessions.delete(id);
    try {
      send(previous.socket, { t: 'error', code: 'bad_message', message: 'replaced by a newer connection' });
      previous.socket.close(1008, 'replaced by a newer connection');
    } catch {}
  }
  session.id = id;
  session.name = typeof device.name === 'string' ? truncate(device.name, 64) : '';
  session.type = typeof device.type === 'string' ? truncate(device.type, 32) : 'unknown';
  session.publicKey = typeof device.publicKey === 'string' ? truncate(device.publicKey, 512) : '';
  session.helloed = true;
  sessions.set(id, session);
  rememberDevice(id, { name: session.name, type: session.type, publicKey: session.publicKey });
  if (session.helloTimeout) {
    clearTimeout(session.helloTimeout);
    session.helloTimeout = null;
  }
  send(socket, {
    t: 'ready',
    v: PROTOCOL_VERSION,
    self: { id },
    ice: { stun: config.stun.slice(), turn: turnCredentials(id) },
    peers: rosterFor(id),
    limits: { maxFrameBytes: config.maxFrameBytes },
  });
  log('info', 'hello', { device: id, name: session.name, type: session.type, clients: sessions.size });
  if (typeof message.pairToken === 'string' && message.pairToken) {
    const code = consumePairToken(session, socket, message.pairToken, now);
    if (code) {
      const messages = {
        bad_message: 'pairToken is malformed',
        pair_unknown: 'no such pairing invitation',
        pair_expired: 'pairing invitation expired',
        pair_used: 'pairing invitation already used',
        pair_self: 'a device cannot pair with itself',
        pair_not_online: 'the inviting device is not online',
      };
      sendError(socket, code, messages[code] || 'pairing failed');
      log('info', 'pair_failed', { device: id, code });
    }
  }
  broadcastPresence(id);
}

function handlePresence(session, socket, message) {
  const device = message.device;
  if (!device || typeof device !== 'object' || Array.isArray(device)) {
    sendError(socket, 'bad_message', 'presence requires device { name, type }');
    return;
  }
  if (typeof device.name === 'string') session.name = truncate(device.name, 64);
  if (typeof device.type === 'string') session.type = truncate(device.type, 32);
  rememberDevice(session.id, { name: session.name, type: session.type, publicKey: session.publicKey });
  broadcastPresence(session.id);
  log('debug', 'presence', { device: session.id });
}

function handleMessage(session, socket, raw) {
  const now = Date.now();
  if (raw.length > config.maxFrameBytes) {
    sendError(socket, 'frame_too_large', 'frame exceeds ' + config.maxFrameBytes + ' bytes');
    socket.close(1009, 'frame too large');
    return;
  }
  if (now - session.windowStart >= config.rateWindowMs) {
    session.windowStart = now;
    session.windowCount = 0;
  }
  session.windowCount += 1;
  if (session.windowCount > config.rateMax) {
    sendError(socket, 'rate_limited', 'no more than ' + config.rateMax + ' messages per 10 s');
    log('warn', 'rate_limited', { device: session.id || '(anonymous)' });
    socket.close(1008, 'rate limited');
    return;
  }
  let message;
  try {
    message = JSON.parse(raw.toString('utf8'));
  } catch {
    sendError(socket, 'bad_message', 'frame is not valid JSON');
    if (!session.helloed) socket.close(1008, 'invalid hello');
    return;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.t !== 'string') {
    sendError(socket, 'bad_message', 'frame requires a string t field');
    if (!session.helloed) socket.close(1008, 'invalid hello');
    return;
  }
  if (!session.helloed) {
    if (message.t !== 'hello') {
      sendError(socket, 'bad_message', 'hello must be the first frame');
      socket.close(1008, 'invalid hello');
      return;
    }
    handleHello(session, socket, message, now);
    return;
  }
  switch (message.t) {
    case 'hello':
      sendError(socket, 'bad_message', 'already registered');
      return;
    case 'presence':
      handlePresence(session, socket, message);
      return;
    case 'invite':
      handleInvite(session, socket, message, now);
      return;
    case 'signal':
      handleSignal(session, socket, message);
      return;
    case 'ping':
      send(socket, { t: 'pong', ts: now });
      return;
    default:
      sendError(socket, 'bad_message', 'unknown message type: ' + truncate(message.t, 32));
  }
}

wss.on('connection', (socket, request) => {
  const session = {
    socket,
    id: '',
    name: '',
    type: 'unknown',
    publicKey: '',
    helloed: false,
    windowStart: Date.now(),
    windowCount: 0,
    helloTimeout: null,
  };
  session.helloTimeout = setTimeout(() => {
    if (session.helloed) return;
    sendError(socket, 'bad_message', 'hello timeout');
    log('info', 'hello_timeout');
    socket.close(1008, 'hello timeout');
  }, config.helloTimeoutMs);
  if (typeof session.helloTimeout.unref === 'function') session.helloTimeout.unref();

  socket.on('message', (raw) => {
    try {
      handleMessage(session, socket, Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8'));
    } catch (error) {
      log('error', 'handler_failure', { message: truncate(error && error.message, 200) });
      sendError(socket, 'bad_message', 'internal handler failure');
    }
  });
  socket.on('close', () => {
    if (session.helloTimeout) clearTimeout(session.helloTimeout);
    if (!session.helloed || sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    const meta = devices.get(session.id);
    if (meta) meta.lastSeen = Date.now();
    log('info', 'disconnect', { device: session.id, clients: sessions.size });
    broadcastPresence(session.id);
  });
  socket.on('error', (error) => {
    log('debug', 'socket_error', { device: session.id || '(anonymous)', message: truncate(error && error.message, 200) });
  });
  log('debug', 'upgrade_accepted', { origin: truncate(request.headers.origin, 120) });
});

const maintenance = setInterval(() => pruneInvites(Date.now()), 60000);
if (typeof maintenance.unref === 'function') maintenance.unref();

function shutdown(signal) {
  log('info', 'shutdown', { signal, clients: sessions.size });
  for (const session of sessions.values()) {
    try {
      session.socket.close(1001, 'server shutting down');
    } catch {}
  }
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

httpServer.listen(config.port, config.host, () => {
  log('info', 'listening', {
    host: config.host,
    port: config.port,
    origins: config.origins.length ? config.origins : ['*'],
    maxClients: config.maxClients,
    maxFrameBytes: config.maxFrameBytes,
    pairingTtlSeconds: Math.round(config.pairingTtlMs / 1000),
    turn: turnConfigured ? 'configured' : 'disabled',
    stun: config.stun,
  });
});
