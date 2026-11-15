import { ParaBusClient } from './client.ts';
import { ApiError, type Code, type ParticipantTarget, type State } from './protocol.ts';
import { buttonSettings, type ButtonSettings } from './settings.ts';

export type ButtonKind = 'mute' | 'fader-up' | 'fader-down' | 'emergency';
export type View = { title: string; image: string };
export interface ButtonSink { setTitle(title: string): Promise<unknown>; setImage(image: string): Promise<unknown> }
const errors: Record<Code, string> = {
  INVALID: 'INVALID', UNAUTHORIZED: '401\nAUTH', HOST_FORBIDDEN: 'HOST', ORIGIN_FORBIDDEN: 'ORIGIN',
  TIER_FORBIDDEN: 'DENIED', NOT_FOUND: 'NO TARGET', LOCKED: 'LOCKED', STALE_REVISION: 'STALE',
  RATE_LIMITED: 'RATE\nLIMIT', DISABLED: 'DISABLED', UNAVAILABLE: 'ERROR', INTERNAL: 'ERROR',
  OFFLINE: 'OFFLINE', CONNECTING: 'CONNECT', STOPPED: 'STOPPED', CONFIGURE: 'SETUP', BUSY: 'BUSY', INCOMPATIBLE: 'API\nVERSION'
};
type Resolved = { prefix: string; args: Record<string, unknown>; mute?: boolean; db: number; setMute?: (value: boolean) => void };
export function resolveTarget(s: ButtonSettings, state: State): Resolved {
  if (s.target === 'bus') {
    const b = state.buses.find(b => b.busId === s.busId);
    if (!b) throw new ApiError(s.busId ? 'NOT_FOUND' : 'CONFIGURE');
    return { prefix: 'bus', args: { busId: b.busId }, db: b.masterDb, mute: b.mute, setMute: v => { b.mute = v; } };
  }
  if (s.target === 'tx') {
    const b = state.tx.bots.find(b => b.profileId === s.profileId);
    if (!b) throw new ApiError(s.profileId ? 'NOT_FOUND' : 'CONFIGURE');
    if (b.state === 'NO_BOT') throw new ApiError('UNAVAILABLE');
    return { prefix: 'tx', args: { profileId: b.profileId }, db: b.masterDb };
  }
  if (s.target !== 'send') throw new ApiError('CONFIGURE');
  let target: ParticipantTarget, userId: string | undefined;
  if (s.participant === 'slot') {
    if (!s.index) throw new ApiError('CONFIGURE');
    const scope = s.scopeBusId ? { kind: 'bus' as const, busId: s.scopeBusId } : { kind: 'all' as const };
    userId = state.participantOrders.find(o => JSON.stringify(o.scope) === JSON.stringify(scope))?.users[s.index - 1];
    target = { kind: 'slot', scope, index: s.index, expectedParticipantsRevision: state.participantsRevision };
  } else {
    if (!s.discordUserId) throw new ApiError('CONFIGURE');
    userId = s.discordUserId; target = { kind: 'user', discordUserId: userId };
  }
  const p = state.participants.find(p => p.discordUserId === userId);
  if (!p) throw new ApiError('NOT_FOUND');
  const send = p.sends.find(send => send.busId === s.busId);
  if (!s.busId) throw new ApiError('CONFIGURE');
  if (!send || !state.buses.some(b => b.busId === s.busId && b.kind === 'vc')) throw new ApiError('NOT_FOUND');
  return { prefix: 'send', args: { target, busId: s.busId }, db: send.db, mute: send.mute, setMute: v => { send.mute = v; } };
}
export function view(kind: ButtonKind, settings: ButtonSettings, client: ParaBusClient, error?: Code): View {
  if (kind !== 'emergency' && !settings.target) return { title: errors.CONFIGURE, image: 'imgs/offline.svg' };
  if (error) return { title: errors[error], image: 'imgs/error.svg' };
  if (client.status !== 'CONNECTED' || !client.state) return { title: errors[client.status === 'CONNECTED' ? 'OFFLINE' : client.status], image: 'imgs/offline.svg' };
  if (kind === 'emergency') return { title: client.state.emergencyMuted ? 'EMERGENCY\nON' : 'EMERGENCY\nREADY', image: client.state.emergencyMuted ? 'imgs/emergency-on.svg' : 'imgs/emergency.svg' };
  try {
    if (settings.target === 'tx' && client.state.tx.bots.some(b => b.profileId === settings.profileId && b.state === 'NO_BOT')) {
      return { title: 'NO_BOT', image: 'imgs/offline.svg' };
    }
    const target = resolveTarget(settings, client.state);
    if (kind === 'mute') {
      if (target.mute === undefined) throw new ApiError('INVALID');
      return { title: target.mute ? 'MUTED' : 'OPEN', image: target.mute ? 'imgs/muted.svg' : 'imgs/open.svg' };
    }
    const db = Object.is(target.db, -0) ? 0 : target.db;
    return { title: `${db > 0 ? '+' : ''}${Number(db.toFixed(1))} dB\n${kind === 'fader-up' ? '+' : '−'}${settings.stepDb ?? 1}`, image: `imgs/${kind}.svg` };
  } catch (e) { return { title: errors[e instanceof ApiError ? e.code : 'UNAVAILABLE'], image: 'imgs/offline.svg' }; }
}
type Button = { kind: ButtonKind; settings: ButtonSettings; sink: ButtonSink; pending: boolean; error?: Code; timer?: ReturnType<typeof setTimeout>; last?: string; rendering: Promise<void> };
export class Buttons {
  private buttons = new Map<string, Button>();
  private blockedUntil = 0;
  constructor(readonly client: ParaBusClient) { client.onChange(() => this.renderAll()); }
  attach(id: string, kind: ButtonKind, value: unknown, sink: ButtonSink): void {
    this.remove(id);
    const b: Button = { kind, settings: kind === 'emergency' ? {} : buttonSettings(value), sink, pending: false, rendering: Promise.resolve() };
    this.buttons.set(id, b); this.render(b);
  }
  update(id: string, value: unknown): void { const b = this.buttons.get(id); if (b) { b.settings = b.kind === 'emergency' ? {} : buttonSettings(value); b.error = undefined; this.render(b); } }
  remove(id: string): void { const b = this.buttons.get(id); if (b?.timer) clearTimeout(b.timer); this.buttons.delete(id); }
  dispose(): void { for (const id of this.buttons.keys()) this.remove(id); }
  settings(id: string): ButtonSettings { return this.buttons.get(id)?.settings ?? {}; }
  private render(b: Button): void {
    const v = view(b.kind, b.settings, this.client, b.error), signature = JSON.stringify(v);
    if (signature === b.last) return; b.last = signature;
    b.rendering = b.rendering.then(async () => { await b.sink.setImage(v.image); await b.sink.setTitle(v.title); }).catch(() => { b.last = undefined; });
  }
  private renderAll(): void { for (const b of this.buttons.values()) this.render(b); }
  private fail(b: Button, code: Code): void {
    b.error = code; if (b.timer) clearTimeout(b.timer); this.render(b);
    b.timer = setTimeout(() => { b.error = undefined; b.timer = undefined; this.render(b); }, 1500);
    b.timer.unref();
  }
  async press(id: string): Promise<void> {
    const b = this.buttons.get(id); if (!b) return;
    if (b.kind !== 'emergency' && !b.settings.target) {
      b.error = undefined;
      if (b.timer) clearTimeout(b.timer); b.timer = undefined;
      this.render(b); return;
    }
    if (this.client.status !== 'CONNECTED' || !this.client.state) {
      b.error = undefined;
      if (b.timer) clearTimeout(b.timer); b.timer = undefined;
      this.client.connectOnPress(); this.render(b); return;
    }
    if (b.pending) { this.fail(b, 'BUSY'); return; }
    if (Date.now() < this.blockedUntil && b.kind !== 'emergency') { this.fail(b, 'RATE_LIMITED'); return; }
    b.pending = true; b.error = undefined;
    try {
      if (b.kind === 'emergency') { await this.client.execute('emergency.set', { active: true }); return; }
      if (this.client.status !== 'CONNECTED' || !this.client.state) throw new ApiError(this.client.status === 'CONNECTED' ? 'OFFLINE' : this.client.status);
      const settings = b.settings;
      const instanceId = this.client.state.instanceId, revision = this.client.state.revision;
      const target = resolveTarget(settings, this.client.state);
      if (b.kind === 'mute') {
        if (target.mute === undefined) throw new ApiError('INVALID');
        try { await this.client.execute(`${target.prefix}.mute.toggle`, { ...target.args, expectedMute: target.mute }); }
        catch (e) {
          if (e instanceof ApiError && e.code === 'STALE_REVISION' && e.currentMute !== undefined) {
            // Never apply a correction to a new instance or a slot now occupied by somebody else.
            if (this.client.state?.instanceId === instanceId && this.client.state.revision === revision) {
              this.client.patchMute(state => resolveTarget(settings, state).setMute?.(e.currentMute!));
            }
            return;
          }
          throw e;
        }
      } else await this.client.execute(`${target.prefix}.fader.adjust`, { ...target.args, deltaDb: (b.settings.stepDb ?? 1) * (b.kind === 'fader-up' ? 1 : -1) });
    } catch (e) {
      const error = e instanceof ApiError ? e : new ApiError('UNAVAILABLE');
      if (error.code === 'RATE_LIMITED') this.blockedUntil = Date.now() + Math.max(1000, error.retryAfterMs);
      this.fail(b, error.code);
    } finally { b.pending = false; this.render(b); }
  }
}
