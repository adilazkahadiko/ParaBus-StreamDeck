import { isIP, connect as connectTcp } from 'node:net';
import { connect, type TLSSocket } from 'node:tls';
import { Agent } from 'node:https';
import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import { ApiError } from './protocol.ts';

export type LanConnection = { v: 1; address: string; port: number; token: string; fingerprint: string };
export const validAddress = (value: unknown): value is string => typeof value === 'string' && isIP(value) === 4 && value !== '0.0.0.0' && Number(value.split('.')[0]) < 224;
/** Flat, versioned schema; reject duplicate/escaped duplicate keys as well. */
export function parseConnectionCode(code: unknown): LanConnection {
  try {
    if (typeof code !== 'string' || code.length > 4096 || !/^parabus1:[A-Za-z0-9_-]+$/.test(code)) throw 0;
    const bytes = Buffer.from(code.slice(9), 'base64url');
    if (bytes.toString('base64url') !== code.slice(9)) throw 0;
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes), value = JSON.parse(json);
    const keys = [...json.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map(match => JSON.parse(match[1]) as string);
    if (!value || typeof value !== 'object' || Array.isArray(value) || keys.length !== 5 || new Set(keys).size !== 5
      || keys.some(key => !['v', 'address', 'port', 'token', 'fingerprint'].includes(key))
      || value.v !== 1 || !validAddress(value.address) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
      || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
      || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw 0;
    return { v: 1, address: value.address, port: value.port, token: value.token, fingerprint: value.fingerprint };
  } catch { throw new ApiError('INVALID'); }
}

/** No HTTP bytes (including Authorization) may be written until this resolves.
 * Same raw DER pin, TLS 1.3, validity and self-signature checks as ParaBus's
 * lan-client.ts. An IP override changes routing only; it never changes the pin. */
export function pinnedSocket(target: Pick<LanConnection, 'address' | 'port' | 'fingerprint'>, signal?: AbortSignal): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tcp = connectTcp({ host: target.address, port: target.port });
    const socket = connect({ socket: tcp, rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
    let settled = false;
    const abort = () => fail('OFFLINE');
    const cleanup = () => { clearTimeout(deadline); signal?.removeEventListener('abort', abort); };
    const fail = (code: 'OFFLINE' | 'CERTIFICATE') => { if (settled) return; settled = true; cleanup(); socket.destroy(); reject(new ApiError(code)); };
    const deadline = setTimeout(() => fail('OFFLINE'), 5000); deadline.unref();
    // Transport failures during the handshake are retryable. CERTIFICATE is
    // reserved for completed-handshake peer checks below.
    tcp.on('error', () => fail('OFFLINE')); socket.on('error', () => fail('OFFLINE'));
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) { abort(); return; }
    socket.once('close', () => { if (!settled) fail('OFFLINE'); });
    socket.once('secureConnect', () => {
      try {
        const raw = socket.getPeerCertificate().raw;
        if (!raw || socket.getProtocol() !== 'TLSv1.3' || !timingSafeEqual(createHash('sha256').update(raw).digest(), Buffer.from(target.fingerprint, 'hex'))) return fail('CERTIFICATE');
        const cert = new X509Certificate(raw), from = Date.parse(cert.validFrom), to = Date.parse(cert.validTo), now = Date.now();
        if (!Number.isFinite(from) || !Number.isFinite(to) || now < from || now > to || !cert.verify(cert.publicKey)) return fail('CERTIFICATE');
        settled = true; cleanup(); resolve(socket);
      } catch { fail('CERTIFICATE'); }
    });
  });
}

/** Both HTTPS requests and WSS upgrades get a fresh, preverified connection. */
export function pinnedAgent(target: Pick<LanConnection, 'address' | 'port' | 'fingerprint'>, signal?: AbortSignal): Agent {
  const agent = new Agent({ keepAlive: false, maxCachedSessions: 0 });
  agent.createConnection = (_options, callback) => {
    void pinnedSocket(target, signal).then(socket => callback!(null, socket), error => callback!(error, undefined as unknown as TLSSocket));
    return undefined as unknown as TLSSocket;
  };
  return agent;
}
