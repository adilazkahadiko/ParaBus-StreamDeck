import { request, type ClientRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { ApiError, parseState, safeCode, uuid, type Code, type State } from './protocol.ts';
import { globalSettings, record, type GlobalSettings } from './settings.ts';

export interface Clock {
  now(): number;
  random(): number;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}
const realClock: Clock = { now: Date.now, random: Math.random, setTimeout, clearTimeout };
export function backoff(attempt: number, random: number): number {
  return Math.min(30000, 1000 * 2 ** Math.min(attempt, 5) * (1 + Math.min(1, Math.max(0, random)) * 0.25));
}
export class ParaBusClient {
  state?: State;
  status: Code | 'CONNECTED' = 'CONFIGURE';
  reconnectDelay?: number;
  private config: GlobalSettings = { port: 4175, token: '' };
  private generation = 0;
  private stopped = true;
  private connecting = false;
  private disabledPolling = false;
  private ws?: WebSocket;
  private requests = new Set<ClientRequest>();
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private connectedAt?: number;
  private operations = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(private clock: Clock = realClock) {}
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed(): void { for (const fn of this.listeners) fn(); }
  get connectionSettings(): { port: number; tokenConfigured: boolean } { return { port: this.config.port, tokenConfigured: !!this.config.token }; }
  configure(value: unknown): void {
    this.stop(); this.config = globalSettings(value); this.attempt = 0;
    if (!this.config.token) { this.status = 'CONFIGURE'; this.changed(); return; }
    this.stopped = false; void this.connect(this.generation);
  }
  /** An offline press is consumed by connection setup, never retained as an action. */
  connectOnPress(): void {
    if (this.status === 'UNAUTHORIZED' || this.status === 'CONFIGURE' || !this.config.token) return;
    if (this.status === 'CONNECTED' && this.state) return;
    if (this.connecting) {
      // Join the current probe rather than opening parallel connections on repeated presses.
      this.status = 'CONNECTING'; this.changed(); return;
    }
    this.configure(this.config);
  }
  stop(): void {
    this.stopped = true; this.connecting = false; this.disabledPolling = false;
    this.generation++; this.state = undefined; this.operations.clear();
    this.connectedAt = undefined; this.reconnectDelay = undefined;
    if (this.timer) this.clock.clearTimeout(this.timer); this.timer = undefined;
    if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = undefined;
    const ws = this.ws; this.ws = undefined; ws?.terminate();
    for (const req of this.requests) req.destroy();
    this.status = 'STOPPED'; this.changed();
  }
  private halt(code: Code): void { this.stop(); this.status = code; this.changed(); }
  private live(generation: number): boolean { return !this.stopped && generation === this.generation; }
  private async http(path: '/info' | '/state' | '/actions', body?: unknown): Promise<Record<string, unknown>> {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: this.config.port, path: `/external/v1${path}`,
        method: encoded ? 'POST' : 'GET', agent: false,
        headers: { Authorization: `Bearer ${this.config.token}`, ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) }
      }, res => {
        let bytes = 0; const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) req.destroy(); else chunks.push(chunk); });
        res.on('error', () => reject(new ApiError('OFFLINE')));
        res.on('end', () => {
          try {
            const v = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            if (res.statusCode === 401) throw new ApiError('UNAUTHORIZED');
            if (res.statusCode !== 200 || v.ok !== true) {
              const retry = Number(res.headers['retry-after']);
              throw new ApiError(safeCode(v.code), typeof record(v.current).mute === 'boolean' ? record(v.current).mute as boolean : undefined,
                Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0);
            }
            if (!uuid(v.instanceId) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1) throw new ApiError('UNAVAILABLE');
            resolve(v);
          } catch (e) { reject(e instanceof ApiError ? e : new ApiError(res.statusCode === 401 ? 'UNAUTHORIZED' : 'UNAVAILABLE')); }
        });
      });
      this.requests.add(req); req.once('close', () => this.requests.delete(req));
      // A total deadline also bounds trickle responses, unlike an idle timeout alone.
      const deadline = setTimeout(() => req.destroy(), 5000); deadline.unref();
      req.once('close', () => clearTimeout(deadline));
      req.setTimeout(5000, () => req.destroy());
      req.on('error', () => reject(new ApiError('OFFLINE')));
      if (encoded) req.write(encoded); req.end();
    });
  }
  private async connect(g: number): Promise<void> {
    if (!this.live(g)) return;
    this.connecting = true;
    if (!this.disabledPolling) this.status = 'CONNECTING';
    this.reconnectDelay = undefined; this.changed();
    try {
      const info = await this.http('/info'); if (!this.live(g)) return;
      const data = record(info.data);
      if (typeof data.apiVersion !== 'string' || data.apiVersion.split('.')[0] !== '1' || !Array.isArray(data.operations)) throw new ApiError('INCOMPATIBLE');
      this.operations = new Set(data.operations.filter(x => Array.isArray(record(x).tiers) && (record(x).tiers as unknown[]).includes('A')).map(x => String(record(x).name)));
      const result = await this.http('/state'); if (!this.live(g)) return;
      const state = parseState(result.data);
      if (info.instanceId !== state.instanceId || result.instanceId !== state.instanceId) throw new ApiError('STALE_REVISION');
      if (!state.enabled) throw new ApiError('DISABLED');
      this.state = state;
      const ws = new WebSocket(`ws://127.0.0.1:${this.config.port}/external/v1/ws`, {
        headers: { Authorization: `Bearer ${this.config.token}` }, followRedirects: false,
        handshakeTimeout: 5000, maxPayload: 1024 * 1024, perMessageDeflate: false
      });
      this.ws = ws;
      const watch = (ms: number) => {
        if (this.watchdog) clearTimeout(this.watchdog);
        this.watchdog = setTimeout(() => { if (this.live(g) && ws === this.ws) this.reconnect(g, new ApiError('OFFLINE')); }, ms);
        this.watchdog.unref();
      };
      watch(5000); // An upgrade without the mandatory initial state is not connected.
      ws.on('ping', () => { if (this.live(g) && ws === this.ws && this.status === 'CONNECTED') watch(45000); });
      ws.on('message', raw => {
        if (!this.live(g) || ws !== this.ws) return;
        try {
          const msg = record(JSON.parse(raw.toString()));
          if (msg.type === 'error') {
            const code = safeCode(record(msg.payload).code);
            this.reconnect(g, new ApiError(code));
          } else if (msg.type === 'state') {
            const next = parseState(msg.payload);
            if (!next.enabled) { this.reconnect(g, new ApiError('DISABLED')); return; }
            if (next.instanceId !== this.state?.instanceId) { this.reconnect(g, new ApiError('STALE_REVISION')); return; }
            if (next.revision < this.state.revision) return;
            this.state = next; this.status = 'CONNECTED';
            this.connecting = false; this.disabledPolling = false;
            watch(45000);
            this.connectedAt ??= this.clock.now(); this.changed();
          }
        } catch { this.reconnect(g, new ApiError('UNAVAILABLE')); }
      });
      ws.on('unexpected-response', (_req, res) => {
        if (!this.live(g) || ws !== this.ws) { res.resume(); return; }
        let body = '';
        res.on('data', chunk => { if (body.length < 16384) body += chunk.toString(); });
        res.on('end', () => {
          if (!this.live(g) || ws !== this.ws) return;
          let code: Code = res.statusCode === 401 ? 'UNAUTHORIZED' : 'UNAVAILABLE';
          try { if (res.statusCode !== 401) code = safeCode(record(JSON.parse(body)).code); } catch { /* fixed code only */ }
          const seconds = Number(res.headers['retry-after']);
          this.reconnect(g, new ApiError(code, undefined, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0));
        });
      });
      ws.on('error', () => { /* close handles retry; never log the request/error object */ });
      ws.on('close', code => {
        if (!this.live(g) || ws !== this.ws) return;
        // Close codes select connection policy, never establish a past operation's result.
        if (code === 4001) this.halt('UNAUTHORIZED');
        else if (code === 4003) this.reconnect(g, new ApiError('DISABLED'));
        else this.reconnect(g, new ApiError('OFFLINE'));
      });
    } catch (e) { if (this.live(g)) this.reconnect(g, e instanceof ApiError ? e : new ApiError('UNAVAILABLE')); }
  }
  private reconnect(g: number, error: ApiError): void {
    if (!this.live(g)) return;
    if (['UNAUTHORIZED', 'INCOMPATIBLE'].includes(error.code)) { this.halt(error.code); return; }
    if (error.code === 'DISABLED') this.disabledPolling = true;
    if (this.connectedAt !== undefined && this.clock.now() - this.connectedAt >= 30000) this.attempt = 0;
    this.connecting = false; this.connectedAt = undefined; this.state = undefined;
    this.status = this.disabledPolling ? 'DISABLED' : error.code;
    const ws = this.ws; this.ws = undefined; ws?.terminate();
    if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = undefined;
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.reconnectDelay = this.disabledPolling ? 5000 : Math.max(backoff(this.attempt++, this.clock.random()), error.retryAfterMs);
    this.changed();
    this.timer = this.clock.setTimeout(() => { this.timer = undefined; void this.connect(g); }, this.reconnectDelay);
  }
  /** One physical press, one POST, one UUID. No automatic action retries or queue. */
  async execute(operation: string, args: unknown): Promise<void> {
    if (this.status !== 'CONNECTED' || !this.state) throw new ApiError(this.status === 'CONNECTED' ? 'OFFLINE' : this.status);
    if (!this.operations.has(operation)) throw new ApiError('INCOMPATIBLE');
    const g = this.generation, instanceId = this.state.instanceId, requestId = randomUUID();
    try {
      const result = await this.http('/actions', { requestId, instanceId, operation, args });
      if (!this.live(g)) throw new ApiError('STOPPED');
      if (result.requestId !== requestId) throw new ApiError('UNAVAILABLE');
      if (result.instanceId !== instanceId) throw new ApiError('STALE_REVISION');
    } catch (e) {
      const error = e instanceof ApiError ? e : new ApiError('UNAVAILABLE');
      if (this.live(g)) {
        if (error.code === 'UNAUTHORIZED') this.halt(error.code);
        else if (error.code === 'DISABLED') this.reconnect(g, error);
        else if (['OFFLINE', 'UNAVAILABLE'].includes(error.code)) this.reconnect(g, error);
        else if (error.code === 'STALE_REVISION' && error.currentMute === undefined) this.reconnect(g, error);
      }
      throw error;
    }
  }
  patchMute(update: (state: State) => void): void { if (this.state) { update(this.state); this.changed(); } }
}
