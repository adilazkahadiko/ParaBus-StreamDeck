import { record } from './settings.ts';

export type Scope = { kind: 'all' } | { kind: 'bus'; busId: string };
export type ParticipantTarget = { kind: 'user'; discordUserId: string } | {
  kind: 'slot'; scope: Scope; index: number; expectedParticipantsRevision: number
};
export type State = {
  instanceId: string; revision: number; participantsRevision: number; enabled: boolean; emergencyMuted: boolean;
  participants: { discordUserId: string; sends: { busId: string; db: number; mute: boolean }[]; displayName?: string }[];
  registeredUsers: { discordUserId: string; online: boolean; displayName?: string }[];
  participantOrders: { scope: Scope; users: string[] }[];
  buses: { busId: string; kind: string; label?: string; masterDb: number; mute: boolean }[];
  selectors: { selectorId: string; name: string; mode: 'SWITCH' | 'ADDITIVE'; fadeMs: number; sourceBusIds: string[]; selectedBusIds: string[]; primaryBusId: string | null; emergencyMuted: boolean }[];
  tx: { bots: { profileId: string; masterDb: number; state: string }[] };
  permissions: { readDisplayNames: boolean };
};
export const codes = ['INVALID', 'UNAUTHORIZED', 'HOST_FORBIDDEN', 'ORIGIN_FORBIDDEN', 'TIER_FORBIDDEN', 'NOT_FOUND', 'LOCKED', 'STALE_REVISION', 'RATE_LIMITED', 'DISABLED', 'UNAVAILABLE', 'INTERNAL', 'OFFLINE', 'CONNECTING', 'STOPPED', 'CONFIGURE', 'BUSY', 'INCOMPATIBLE', 'CERTIFICATE'] as const;
export type Code = typeof codes[number];
export function safeCode(value: unknown): Code { return codes.includes(value as Code) ? value as Code : 'UNAVAILABLE'; }
export class ApiError extends Error {
  constructor(readonly code: Code, readonly currentMute?: boolean, readonly retryAfterMs = 0) { super(code); }
}
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(v);
const rev = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const text = (v: unknown): string => { if (typeof v !== 'string' || !v.length || v.length > 256) throw new ApiError('UNAVAILABLE'); return v; };
const bool = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new ApiError('UNAVAILABLE'); return v; };
const db = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiError('UNAVAILABLE'); return v; };
const array = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new ApiError('UNAVAILABLE'); return v; };
const displayName = (v: unknown): string | undefined => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) : undefined;
function scope(v: unknown): Scope { const s = record(v); if (s.kind === 'all') return { kind: 'all' }; if (s.kind === 'bus') return { kind: 'bus', busId: text(s.busId) }; throw new ApiError('UNAVAILABLE'); }

/** Project just what we need. Never forward raw server objects to the PI or logs. */
export function parseState(value: unknown): State {
  const v = record(value);
  if (!uuid(v.instanceId) || !rev(v.revision) || v.participantsRevision !== undefined && !rev(v.participantsRevision)) throw new ApiError('UNAVAILABLE');
  const names = record(v.permissions).readDisplayNames === true;
  const name = (v: Record<string, unknown>) => names && displayName(v.displayName) ? { displayName: displayName(v.displayName) } : {};
  return {
    instanceId: v.instanceId, revision: v.revision, participantsRevision: v.participantsRevision as number ?? 1,
    enabled: bool(v.enabled), emergencyMuted: bool(v.emergencyMuted), permissions: { readDisplayNames: names },
    participants: array(v.participants ?? []).map(x => { const p = record(x); return {
      discordUserId: text(p.discordUserId), ...name(p),
      sends: array(p.sends ?? []).map(x => { const s = record(x); return { busId: text(s.busId), db: db(s.db), mute: bool(s.mute) }; })
    }; }),
    registeredUsers: array(v.registeredUsers ?? []).map(x => { const p = record(x); return { discordUserId: text(p.discordUserId), online: bool(p.online), ...name(p) }; }),
    participantOrders: array(v.participantOrders ?? []).map(x => { const p = record(x); return { scope: scope(p.scope), users: array(p.users).map(text) }; }),
    buses: array(v.buses).map(x => { const b = record(x), label = names ? displayName(b.label) : undefined; return {
      busId: text(b.busId), kind: b.kind === undefined ? 'vc' : text(b.kind), ...(label ? { label } : {}), masterDb: b.masterDb === undefined ? 0 : db(b.masterDb), mute: b.mute === undefined ? false : bool(b.mute)
    }; }),
    tx: { bots: array(record(v.tx).bots ?? []).map(x => { const b = record(x); return { profileId: text(b.profileId), masterDb: b.masterDb === undefined ? 0 : db(b.masterDb), state: text(b.state) }; }) },
    selectors: array(v.selectors ?? []).map(x => {
      const s = record(x);
      if (!['SWITCH', 'ADDITIVE'].includes(String(s.mode)) || !Number.isInteger(s.fadeMs) || Number(s.fadeMs) < 0 || Number(s.fadeMs) > 2000) throw new ApiError('UNAVAILABLE');
      const sourceBusIds = array(s.sourceBusIds).map(text), selectedBusIds = array(s.selectedBusIds).map(text);
      if (selectedBusIds.some(id => !sourceBusIds.includes(id)) || s.primaryBusId !== null && !selectedBusIds.includes(String(s.primaryBusId))) throw new ApiError('UNAVAILABLE');
      return { selectorId: text(s.selectorId), name: displayName(s.name) ?? 'Selector', mode: s.mode as 'SWITCH' | 'ADDITIVE', fadeMs: Number(s.fadeMs), sourceBusIds, selectedBusIds, primaryBusId: s.primaryBusId === null ? null : text(s.primaryBusId), emergencyMuted: bool(s.emergencyMuted) };
    })
  };
}
