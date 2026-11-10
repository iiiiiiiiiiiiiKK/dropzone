/**
 * Local end-to-end verification for the DROPZONE signaling service (protocol v1).
 *
 * Default mode spawns server/index.mjs and runs the full suite on loopback.
 *   node tests/signal-local.mjs
 *
 * Worker mode points the same core suite at a running wrangler dev / deployed Worker:
 *   SIGNAL_URL=http://127.0.0.1:8788 node tests/signal-local.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TURN_SECRET = 'test-static-auth-secret-0123456789';
const TURN_URLS = 'turn:turn.example.test:3478?transport=udp,turn:turn.example.test:3478?transport=tcp';
const STUN_URLS = 'stun:stun.example.test:3478';

let passed = 0;
function pass(name, detail) {
  passed += 1;
  console.log('PASS ' + name + (detail ? ' :: ' + detail : ''));
}
function token() {
  return randomBytes(32).toString('base64url');
}
function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function publicKey() {
  return randomBytes(48).toString('base64url');
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function device(id, name) {
  return { id, name: name || id, type: 'browser', publicKey: publicKey() };
}
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'error' }, env),
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error('server exited ' + code + ': ' + stderr);
  });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error('server exited early: ' + stderr);
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health');
      if (response.ok) return { child, port, base: 'http://127.0.0.1:' + port, wsUrl: 'ws://127.0.0.1:' + port + '/ws' };
    } catch {}
    await sleep(50);
  }
  child.kill();
  throw new Error('server did not become healthy: ' + stderr);
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.queue = [];
    this.waiters = [];
    this.closed = null;
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      this.deliver(message);
    });
    socket.on('close', (code) => {
      this.closed = { code };
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('socket closed (' + code + ') while waiting for ' + waiter.label));
      }
    });
  }
  deliver(message) {
    const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const waiter = this.waiters.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    this.queue.push(message);
  }
  waitFor(predicate, label, timeoutMs) {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, label: label || 'frame', timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error('timeout waiting for ' + (label || 'frame')));
      }, timeoutMs || 6000);
      this.waiters.push(waiter);
    });
  }
  send(payload) {
    this.socket.send(JSON.stringify(payload));
  }
  waitClose(timeoutMs) {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs || 6000);
      this.socket.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code });
      });
    });
  }
  terminate() {
    try {
      this.socket.terminate();
    } catch {}
  }
}

async function connect(url, options) {
  const socket = new WebSocket(url, options || {});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 8000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return new Client(socket);
}

async function hello(client, payload) {
  client.send(payload);
  return client.waitFor((message) => message.t === 'ready', 'ready');
}

/** Shared protocol contract: works against server/index.mjs and the Worker. */
async function coreSuite(ctx) {
  const health = await fetch(ctx.base + '/health');
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assert.equal(healthBody.status, 'ok');
  assert.equal(healthBody.service, 'dropzone-signaling');
  assert.equal(typeof healthBody.clients, 'number');
  assert.equal(typeof healthBody.paired, 'number');
  assert.equal(typeof healthBody.uptime, 'number');
  pass(ctx.label + 'GET /health shape', JSON.stringify(healthBody));

  const configBody = await (await fetch(ctx.base + '/config.json')).json();
  assert.equal(configBody.rtc.turnConfigured, ctx.expectTurn);
  assert.deepEqual(configBody.rtc.stun, [STUN_URLS]);
  assert.match(configBody.signalUrl, /^ws[s]?:\/\/.+\/ws$/);
  pass(ctx.label + 'GET /config.json shape', JSON.stringify(configBody));

  const turnResponse = await fetch(ctx.base + '/turn?device=dev-alpha');
  const turnText = await turnResponse.text();
  if (ctx.expectTurn) {
    assert.equal(turnResponse.status, 200);
    const turnBody = JSON.parse(turnText);
    assert.ok(turnBody, 'turn credentials expected');
    const parts = String(turnBody.username).split(':');
    const expiry = Number(parts[0]);
    const nowSeconds = Math.floor(Date.now() / 1000);
    assert.equal(parts[1], 'dev-alpha');
    assert.ok(expiry > nowSeconds && expiry <= nowSeconds + 3660, 'expiry inside TTL window');
    const expected = createHmac('sha1', TURN_SECRET).update(turnBody.username, 'utf8').digest('base64');
    assert.equal(turnBody.credential, expected);
    assert.equal(turnBody.ttl, 3600);
    assert.equal(turnBody.urls.length, 2);
    pass(ctx.label + 'GET /turn HMAC-SHA1 coturn credential matches', turnBody.username + ' -> ' + turnBody.credential);
  } else {
    assert.equal(turnText, 'null');
    pass(ctx.label + 'GET /turn returns null when TURN is unconfigured');
  }

  const a = await connect(ctx.wsUrl);
  const readyA = await hello(a, { t: 'hello', v: 1, device: device('device-a', 'Laptop A') });
  assert.equal(readyA.self.id, 'device-a');
  // A fresh relay reports an empty roster; a durable one (Worker + storage) may
  // still remember pairs from earlier runs, so only the shape is asserted here.
  for (const peer of readyA.peers) {
    assert.equal(typeof peer.id, 'string');
    assert.equal(typeof peer.online, 'boolean');
  }
  assert.equal(readyA.limits.maxFrameBytes, 32768);
  assert.deepEqual(readyA.ice.stun, [STUN_URLS]);
  if (ctx.expectTurn) {
    assert.ok(readyA.ice.turn && readyA.ice.turn.username.endsWith(':device-a'));
  } else {
    assert.equal(readyA.ice.turn, null);
  }
  pass(ctx.label + 'hello -> ready with self, ice (stun' + (ctx.expectTurn ? '+turn' : ' only') + ') and limits');

  a.send({ t: 'ping' });
  const pong = await a.waitFor((message) => message.t === 'pong', 'pong');
  assert.equal(typeof pong.ts, 'number');
  pass(ctx.label + 'ping -> pong with ts');

  const pairToken = token();
  a.send({ t: 'invite', tokenHash: sha256Hex(pairToken), expiresAt: Date.now() + 300000 });
  await sleep(120);

  const b = await connect(ctx.wsUrl);
  const readyB = await hello(b, { t: 'hello', v: 1, device: device('device-b', 'Phone B'), pairToken });
  assert.equal(readyB.self.id, 'device-b');
  const pairedB = await b.waitFor((message) => message.t === 'paired', 'paired b');
  const pairedA = await a.waitFor((message) => message.t === 'paired', 'paired a');
  const peersA = await a.waitFor((message) => message.t === 'peers' && message.peers.length === 1, 'peers a');
  const peersB = await b.waitFor((message) => message.t === 'peers' && message.peers.some((peer) => peer.id === 'device-a'), 'peers b');
  assert.equal(pairedB.peer.id, 'device-a');
  assert.equal(pairedA.peer.id, 'device-b');
  assert.equal(peersA.peers[0].online, true);
  assert.equal(peersA.peers[0].name, 'Phone B');
  assert.equal(peersB.peers[0].online, true);
  assert.ok(peersB.peers[0].publicKey.length > 0);
  pass(ctx.label + 'invite + hello{pairToken} -> paired on both sides, roster online');

  b.send({ t: 'signal', to: 'device-a', data: { kind: 'offer', sdp: 'v=0 fixture sdp' } });
  const relayed = await a.waitFor((message) => message.t === 'signal', 'relayed signal');
  assert.equal(relayed.from, 'device-b');
  assert.equal(relayed.data.kind, 'offer');
  assert.equal(relayed.data.sdp, 'v=0 fixture sdp');
  pass(ctx.label + 'paired relay: B offer reaches A with from + data intact');

  const c = await connect(ctx.wsUrl);
  await hello(c, { t: 'hello', v: 1, device: device('device-c', 'Stranger C') });
  c.send({ t: 'signal', to: 'device-a', data: { kind: 'offer', sdp: 'should not pass' } });
  const notPaired = await c.waitFor((message) => message.t === 'error', 'error c');
  assert.equal(notPaired.code, 'not_paired');
  assert.equal(a.queue.some((message) => message.t === 'signal' && message.from === 'device-c'), false);
  pass(ctx.label + 'unpaired relay rejected with not_paired and never delivered');

  const replay = await connect(ctx.wsUrl);
  await hello(replay, { t: 'hello', v: 1, device: device('device-d', 'Replay D'), pairToken });
  const replayError = await replay.waitFor((message) => message.t === 'error', 'error replay');
  assert.equal(replayError.code, 'pair_used');
  pass(ctx.label + 'pairing token is single use -> pair_used');

  const late = await connect(ctx.wsUrl);
  await hello(late, { t: 'hello', v: 1, device: device('device-e', 'No token E') });
  late.send({ t: 'signal', to: 'device-e', data: { kind: 'candidate', candidate: {} } });
  const selfLink = await late.waitFor((message) => message.t === 'error', 'error e');
  assert.equal(selfLink.code, 'not_paired');
  pass(ctx.label + 'unlinked device cannot signal at all -> not_paired');

  for (const client of [a, b, c, replay, late]) client.terminate();
  return { healthy: true };
}

const children = [];
async function main() {
  const remote = process.env.SIGNAL_URL;
  if (remote) {
    const base = remote.replace(/\/+$/, '');
    const wsUrl = base.replace(/^http/, 'ws') + '/ws';
    await coreSuite({ label: '[worker] ', base, wsUrl, expectTurn: process.env.EXPECT_TURN === '1' });
    console.log('\nALL CHECKS PASSED (' + passed + ' checks, worker mode)');
    return;
  }

  const server = await startServer({
    TURN_URLS,
    TURN_SECRET,
    TURN_TTL_SECONDS: '3600',
    STUN_URLS,
    ALLOWED_ORIGINS: '',
    HELLO_TIMEOUT_MS: '800',
    PAIRING_TTL_SECONDS: '300',
  });
  children.push(server.child);
  await coreSuite({ label: '', base: server.base, wsUrl: server.wsUrl, expectTurn: true });

  const missingDevice = await fetch(server.base + '/turn');
  assert.equal(missingDevice.status, 400);
  const root = await fetch(server.base + '/');
  assert.equal(root.status, 404);
  pass('GET /turn without device -> 400, unknown route -> 404');

  const url = server.wsUrl;

  const selfToken = token();
  const selfOwner = await connect(url);
  await hello(selfOwner, { t: 'hello', v: 1, device: device('device-self', 'Self') });
  selfOwner.send({ t: 'invite', tokenHash: sha256Hex(selfToken), expiresAt: Date.now() + 120000 });
  await sleep(80);
  const selfSecond = await connect(url);
  await hello(selfSecond, { t: 'hello', v: 1, device: device('device-self', 'Self again'), pairToken: selfToken });
  const selfError = await selfSecond.waitFor((message) => message.t === 'error', 'error self');
  assert.equal(selfError.code, 'pair_self');
  pass('self pairing rejected with pair_self');

  const expToken = token();
  const expOwner = await connect(url);
  await hello(expOwner, { t: 'hello', v: 1, device: device('device-exp', 'Expiry owner') });
  expOwner.send({ t: 'invite', tokenHash: sha256Hex(expToken), expiresAt: Date.now() + 900 });
  await sleep(1200);
  const expGuest = await connect(url);
  await hello(expGuest, { t: 'hello', v: 1, device: device('device-exp-guest', 'Late guest'), pairToken: expToken });
  const expError = await expGuest.waitFor((message) => message.t === 'error', 'error expired');
  assert.equal(expError.code, 'pair_expired');
  pass('expired invitation -> pair_expired');

  const offToken = token();
  const offOwner = await connect(url);
  await hello(offOwner, { t: 'hello', v: 1, device: device('device-off', 'Owner offline') });
  offOwner.send({ t: 'invite', tokenHash: sha256Hex(offToken), expiresAt: Date.now() + 120000 });
  await sleep(80);
  offOwner.socket.close();
  await offOwner.waitClose();
  const offGuest = await connect(url);
  await hello(offGuest, { t: 'hello', v: 1, device: device('device-off-guest', 'Guest waiting'), pairToken: offToken });
  const offError = await offGuest.waitFor((message) => message.t === 'error', 'error offline');
  assert.equal(offError.code, 'pair_not_online');
  const offOwnerAgain = await connect(url);
  await hello(offOwnerAgain, { t: 'hello', v: 1, device: device('device-off', 'Owner back') });
  const offGuestAgain = await connect(url);
  await hello(offGuestAgain, { t: 'hello', v: 1, device: device('device-off-guest-2', 'Guest retry'), pairToken: offToken });
  const offPaired = await offGuestAgain.waitFor((message) => message.t === 'paired', 'paired after owner return');
  assert.equal(offPaired.peer.id, 'device-off');
  pass('invitation survives owner disconnect: pair_not_online then paired after reconnect');

  const idle = await connect(url);
  const idleClose = await idle.waitClose(6000);
  assert.equal(idleClose.code, 1008);
  pass('no hello within timeout -> close 1008');

  const flood = await connect(url);
  await hello(flood, { t: 'hello', v: 1, device: device('device-flood', 'Flood') });
  for (let index = 0; index < 80; index += 1) flood.send({ t: 'ping' });
  const rateError = await flood.waitFor((message) => message.t === 'error', 'error rate');
  assert.equal(rateError.code, 'rate_limited');
  const floodClose = await flood.waitClose(6000);
  assert.equal(floodClose.code, 1008);
  pass('61+ messages in 10 s -> error rate_limited then close 1008');

  const oversized = await connect(url);
  await hello(oversized, { t: 'hello', v: 1, device: device('device-big', 'Big frame') });
  oversized.socket.send('x'.repeat(40 * 1024));
  const oversizedClose = await oversized.waitClose(6000);
  assert.equal(oversizedClose.code, 1009);
  pass('frame above 32 KiB -> close 1009');

  const healthAfter = await (await fetch(server.base + '/health')).json();
  assert.ok(healthAfter.clients >= 1);
  assert.ok(healthAfter.paired >= 2);
  pass('GET /health counters after traffic', JSON.stringify(healthAfter));

  for (const client of [selfOwner, selfSecond, expOwner, expGuest, offGuest, offOwnerAgain, offGuestAgain, idle, flood, oversized]) {
    client.terminate();
  }
  server.child.kill();

  const noTurn = await startServer({ ALLOWED_ORIGINS: 'https://ok.example', TURN_URLS: '', TURN_SECRET: '', STUN_URLS: '' });
  children.push(noTurn.child);
  const nullTurn = await fetch(noTurn.base + '/turn?device=dev-x');
  assert.equal(nullTurn.status, 200);
  assert.equal(await nullTurn.text(), 'null');
  const noTurnConfig = await (await fetch(noTurn.base + '/config.json')).json();
  assert.equal(noTurnConfig.rtc.turnConfigured, false);
  pass('TURN unset -> /turn returns null, config.json turnConfigured=false');

  const denied = new WebSocket(noTurn.wsUrl, { origin: 'https://evil.example' });
  const deniedMessage = await new Promise((resolve) => {
    denied.once('error', (error) => resolve(error.message));
    denied.once('open', () => resolve('opened'));
  });
  assert.match(String(deniedMessage), /403/);
  pass('ALLOWED_ORIGINS mismatch -> 403', String(deniedMessage));

  const allowed = new WebSocket(noTurn.wsUrl, { origin: 'https://ok.example' });
  const allowedOpen = await new Promise((resolve) => {
    allowed.once('open', () => resolve('open'));
    allowed.once('error', (error) => resolve(error.message));
  });
  assert.equal(allowedOpen, 'open');
  const allowedClient = new Client(allowed);
  await hello(allowedClient, { t: 'hello', v: 1, device: device('device-origin', 'Allowed origin') });
  pass('ALLOWED_ORIGINS match -> upgrade accepted, hello ok');
  allowed.terminate();
  noTurn.child.kill();

  console.log('\nALL CHECKS PASSED (' + passed + ' checks)');
}

try {
  await main();
  process.exitCode = 0;
} catch (error) {
  console.error('FAILED: ' + (error && error.stack ? error.stack : String(error)));
  process.exitCode = 1;
} finally {
  for (const child of children) {
    try {
      child.kill();
    } catch {}
  }
  setTimeout(() => process.exit(process.exitCode || 0), 250);
}
