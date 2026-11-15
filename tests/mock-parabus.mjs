import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
export const userId = '100000000000000001';
export const busId = 'external-bus:' + 'a'.repeat(43);
export const operations = ['bus.mute.toggle', 'send.mute.toggle', 'bus.fader.adjust', 'send.fader.adjust', 'tx.fader.adjust', 'emergency.set'];
export function fixture() {
  return {
    instanceId: randomUUID(), revision: 1, participantsRevision: 7, enabled: true,
    state: 'READY', settingsLocked: false, emergencyMuted: false, emergencyEpoch: 1, outputCount: 2,
    participants: [{ discordUserId: userId, sends: [{ busId, db: -4, mute: false }] }],
    registeredUsers: [{ discordUserId: userId, online: true }],
    participantOrders: [{ scope: { kind: 'all' }, users: [userId] }, { scope: { kind: 'bus', busId }, users: [userId] }],
    buses: [{ busId, kind: 'vc', masterDb: -3, mute: false, limiterEnabled: true, compressor: { enabled: false, thresholdDb: -12, ratio: 2, attackMs: 5, releaseMs: 100, makeupDb: 0 } }],
    pfl: null, tx: { targetsRevision: 1, armedProfileIds: [], liveProfileIds: [], selectionKind: 'profiles', allTeams: false, takeTier: null,
      bots: [{ profileId: 'TX01', destination: 'TEAM_01', state: 'READY', active: false, masterDb: -6, sourceInputChannelIds: [], sourceMode: 'unassigned' }] },
    recorder: { state: 'IDLE' }, scenes: [], currentSceneId: null, permissions: { allowedTierBOperations: [], readDisplayNames: false }
  };
}
export class MockParaBus {
  token = randomBytes(32).toString('base64url'); // Ephemeral test credential; never printed or persisted.
  state = fixture();
  requests = []; // Header names + auth boolean only. Never retain the bearer value.
  actions = [];
  wsServer = new WebSocketServer({ noServer: true });
  failure;
  pathFailures = {};
  beforeInfo;
  actionFailure;
  upgradeFailure;
  dropAction = false;
  actionDelay = 0;
  suppressInitialState = false;
  malformed = false;
  server = createServer((req, res) => { void this.http(req, res); });
  constructor() {
    this.server.on('upgrade', (req, socket, head) => {
      const accepted = this.capture(req, true);
      const fail = !accepted ? { status: 401, code: 'UNAUTHORIZED' } : this.upgradeFailure ?? this.failure;
      if (fail) {
        const body = JSON.stringify({ ok: false, code: fail.code, message: 'Mock failure' });
        socket.end(`HTTP/1.1 ${fail.status} Error\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`); return;
      }
      this.wsServer.handleUpgrade(req, socket, head, ws => {
        if (!this.suppressInitialState) ws.send(JSON.stringify({ type: 'state', payload: this.state }));
      });
    });
  }
  capture(req, ws = false) {
    const auth = req.headers.authorization === `Bearer ${this.token}`;
    this.requests.push({ path: req.url, method: req.method, ws, auth, names: Object.keys(req.headers), host: req.headers.host,
      contentType: req.headers['content-type'], urlHasToken: req.url.includes(this.token), protocolHasToken: String(req.headers['sec-websocket-protocol']).includes(this.token) });
    return auth && !Object.keys(req.headers).some(k => k === 'origin' || k.startsWith('sec-fetch-')) && req.headers.host === `127.0.0.1:${this.port}`;
  }
  json(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); }
  success(data, requestId) { return { ok: true, ...(requestId ? { requestId } : {}), instanceId: this.state.instanceId, revision: this.state.revision, data }; }
  async http(req, res) {
    if (!this.capture(req)) { this.json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'Mock auth' }); return; }
    if (req.url === '/external/v1/info') await this.beforeInfo?.();
    const failure = this.failure ?? this.pathFailures[req.url];
    if (failure) { this.json(res, failure.status, { ok: false, code: failure.code, message: 'Mock failure' }); return; }
    if (req.url === '/external/v1/info') {
      this.json(res, 200, this.success({ apiVersion: '1.0', paraBusVersion: '0.1.0', features: ['state.ws', 'fader.relative', 'participants.slot', 'participants.user'],
        operations: operations.map(name => ({ name, tiers: ['A'] })), limits: {}, instanceId: this.state.instanceId })); return;
    }
    if (req.url === '/external/v1/state') { this.json(res, 200, this.success(this.state)); return; }
    if (req.url !== '/external/v1/actions' || req.method !== 'POST') { this.json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Mock path' }); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString()); this.actions.push(payload);
    if (this.actionDelay) await new Promise(resolve => setTimeout(resolve, this.actionDelay));
    if (this.dropAction) { req.socket.destroy(); return; }
    if (this.actionFailure) {
      const f = this.actionFailure;
      this.json(res, f.status, { ok: false, code: f.code, message: f.message ?? 'Mock failure', ...(f.current ? { current: f.current } : {}) }, f.code === 'RATE_LIMITED' ? { 'Retry-After': '2' } : {}); return;
    }
    const { operation, args } = payload;
    if (!operations.includes(operation)) { this.json(res, 400, { ok: false, code: 'INVALID', message: 'Mock unsupported operation' }); return; }
    if (payload.instanceId !== this.state.instanceId) { this.json(res, 409, { ok: false, code: 'STALE_REVISION', message: 'Mock stale instance' }); return; }
    const [family, type] = operation.split('.');
    let object, field;
    if (family === 'emergency') this.state.emergencyMuted = args.active;
    else {
      const user = args.target?.kind === 'slot' ? this.state.participantOrders.find(o => JSON.stringify(o.scope) === JSON.stringify(args.target.scope))?.users[args.target.index - 1] : args.target?.discordUserId;
      const p = this.state.participants.find(p => p.discordUserId === user);
      object = family === 'send' ? p?.sends.find(s => s.busId === args.busId) : family === 'bus' ? this.state.buses.find(b => b.busId === args.busId) : this.state.tx.bots.find(b => b.profileId === args.profileId);
      if (!object) { this.json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Mock no target' }); return; }
      if (type === 'mute') {
        if (object.mute !== args.expectedMute) { this.json(res, 409, { ok: false, code: 'STALE_REVISION', message: 'Mock stale mute', current: { mute: object.mute } }); return; }
        object.mute = !object.mute;
      } else { field = family === 'send' ? 'db' : 'masterDb'; object[field] += args.deltaDb; }
    }
    this.state.revision++;
    this.json(res, 200, this.success({}, payload.requestId)); this.broadcast();
  }
  broadcast() { for (const ws of this.wsServer.clients) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'state', payload: this.state })); }
  disconnect(code) { for (const ws of this.wsServer.clients) code ? ws.close(code) : ws.terminate(); }
  async start() { await new Promise(resolve => this.server.listen(0, '127.0.0.1', resolve)); this.port = this.server.address().port; return this; }
  async close() { for (const ws of this.wsServer.clients) ws.terminate(); await new Promise(resolve => this.wsServer.close(resolve)); this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); }
}
export async function until(fn, description = 'condition', timeout = 3000) {
  const end = Date.now() + timeout;
  while (!fn()) { if (Date.now() >= end) throw new Error(`Timed out: ${description}`); await new Promise(resolve => setTimeout(resolve, 5)); }
}
