import { ParaBusClient } from './client.ts';
import { busChoices, buttonName, participantName } from './display-names.ts';
import { ApiError, type Code, type ParticipantTarget, type State } from './protocol.ts';
import { buttonSettings, type ButtonSettings } from './settings.ts';

export type ButtonKind = 'mute' | 'fader-up' | 'fader-down' | 'emergency' | 'selector' | 'selector-off';
export type View = { title: string; image: string };
export interface ButtonSink { setTitle(title: string): Promise<unknown>; setImage(image: string): Promise<unknown> }
const errors: Record<Code, string> = {
  INVALID: 'INVALID', UNAUTHORIZED: '401\nAUTH', HOST_FORBIDDEN: 'HOST', ORIGIN_FORBIDDEN: 'ORIGIN',
  TIER_FORBIDDEN: '権限なし', NOT_FOUND: 'NO TARGET', LOCKED: 'LOCKED', STALE_REVISION: 'STALE',
  RATE_LIMITED: 'RATE\nLIMIT', DISABLED: 'DISABLED', UNAVAILABLE: 'ERROR', INTERNAL: 'ERROR',
  OFFLINE: 'OFFLINE', CONNECTING: 'CONNECT', STOPPED: 'STOPPED', CONFIGURE: 'SETUP', BUSY: 'BUSY', INCOMPATIBLE: 'API\nVERSION', CERTIFICATE: '証明書\n確認不可'
};
const isSelector = (kind: ButtonKind) => kind === 'selector' || kind === 'selector-off';
const configured = (kind: ButtonKind, s: ButtonSettings) => kind === 'emergency' || (isSelector(kind) ? !!s.selectorId && (kind === 'selector-off' || !!s.busId) : !!s.target);
export function selectorTarget(settings: ButtonSettings, client: ParaBusClient) {
  const selector = client.state?.selectors.find(s => s.selectorId === settings.selectorId);
  if (!selector) throw new ApiError(client.isLan ? 'TIER_FORBIDDEN' : 'NOT_FOUND');
  return selector;
}
export function teamChoices(state: State, selectorId?: string) {
  return (state.selectors.find(s => s.selectorId === selectorId)?.sourceBusIds ?? []).map((id, i) => ({ id,
    label: state.permissions.readDisplayNames && state.buses.find(bus => bus.busId === id)?.label || `Team ${i + 1}` }));
}
type Resolved = { name: string; prefix: string; args: Record<string, unknown>; mute?: boolean; db: number; setMute?: (value: boolean) => void };
export function resolveTarget(s: ButtonSettings, state: State): Resolved {
  if (s.target === 'bus') {
    const b = state.buses.find(b => b.busId === s.busId);
    if (!b) throw new ApiError(s.busId ? 'NOT_FOUND' : 'CONFIGURE');
    return { name: busChoices(state).find(bus => bus.id === b.busId)!.label,
      prefix: 'bus', args: { busId: b.busId }, db: b.masterDb, mute: b.mute, setMute: v => { b.mute = v; } };
  }
  if (s.target === 'tx') {
    const b = state.tx.bots.find(b => b.profileId === s.profileId);
    if (!b) throw new ApiError(s.profileId ? 'NOT_FOUND' : 'CONFIGURE');
    if (b.state === 'NO_BOT') throw new ApiError('UNAVAILABLE');
    return { name: `TX ${state.tx.bots.indexOf(b) + 1}`, prefix: 'tx', args: { profileId: b.profileId }, db: b.masterDb };
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
  return { name: participantName(state, p.discordUserId), prefix: 'send', args: { target, busId: s.busId }, db: send.db, mute: send.mute, setMute: v => { send.mute = v; } };
}
export function view(kind: ButtonKind, settings: ButtonSettings, client: ParaBusClient, error?: Code): View {
  if (!configured(kind, settings)) return { title: errors.CONFIGURE, image: 'imgs/offline.svg' };
  if (error) return { title: kind === 'selector' && error === 'LOCKED' ? 'OFFを使用' : errors[error], image: 'imgs/error.svg' };
  if (client.status !== 'CONNECTED' || !client.state) return { title: errors[client.status === 'CONNECTED' ? 'OFFLINE' : client.status], image: 'imgs/offline.svg' };
  try {
    if (isSelector(kind)) {
      const selector = selectorTarget(settings, client);
      if (client.isLan && !client.canExecute(kind === 'selector' ? 'selector.select' : 'selector.off')) throw new ApiError('TIER_FORBIDDEN');
      if (kind === 'selector-off') return { title: `${buttonName(settings.label || selector.name)}\nOFF`, image: selector.selectedBusIds.length ? 'imgs/selector-off.svg' : 'imgs/open.svg' };
      const team = teamChoices(client.state, settings.selectorId).find(team => team.id === settings.busId);
      if (!team) throw new ApiError(client.isLan ? 'TIER_FORBIDDEN' : 'NOT_FOUND');
      const selected = selector.selectedBusIds.includes(team.id), extra = selector.mode === 'SWITCH' && selected && selector.primaryBusId !== team.id;
      return { title: `${buttonName(settings.label || team.label)}\n${selector.emergencyMuted ? '緊急MUTE' : selected ? extra ? '＋ ON' : 'ON' : 'OFF'}`, image: selected ? 'imgs/open.svg' : 'imgs/selector.svg' };
    }
    if (kind === 'emergency') {
      if (client.isLan && !client.canExecute('emergency.set')) throw new ApiError('TIER_FORBIDDEN');
      return { title: client.state.emergencyMuted ? 'EMERGENCY\nON' : 'EMERGENCY\nREADY', image: client.state.emergencyMuted ? 'imgs/emergency-on.svg' : 'imgs/emergency.svg' };
    }
    if (client.isLan && !client.canExecute(`${settings.target}.${kind === 'mute' ? 'mute.toggle' : 'fader.adjust'}`)) throw new ApiError('TIER_FORBIDDEN');
    if (settings.target === 'tx' && client.state.tx.bots.some(b => b.profileId === settings.profileId && b.state === 'NO_BOT')) {
      return { title: 'NO_BOT', image: 'imgs/offline.svg' };
    }
    const target = resolveTarget(settings, client.state);
    if (client.isLan && !client.canExecute(`${target.prefix}.${kind === 'mute' ? 'mute.toggle' : 'fader.adjust'}`)) throw new ApiError('TIER_FORBIDDEN');
    if (kind === 'mute') {
      if (target.mute === undefined) throw new ApiError('INVALID');
      return { title: `${buttonName(settings.label || target.name)}\n${target.mute ? 'MUTED' : 'OPEN'}`, image: target.mute ? 'imgs/muted.svg' : 'imgs/open.svg' };
    }
    const db = Object.is(target.db, -0) ? 0 : target.db;
    return { title: `${buttonName(settings.label || target.name)}\n${db > 0 ? '+' : ''}${Number(db.toFixed(1))} dB\n${kind === 'fader-up' ? '+' : '−'}${settings.stepDb ?? 1}`, image: `imgs/${kind}.svg` };
  } catch (e) { return { title: errors[e instanceof ApiError ? e.code : 'UNAVAILABLE'], image: 'imgs/offline.svg' }; }
}
type Button = { kind: ButtonKind; settings: ButtonSettings; sink: ButtonSink; pending: boolean; error?: Code; timer?: ReturnType<typeof setTimeout>; last?: string; rendering: Promise<void>; down?: { at: number; instanceId: string; settings: string } };
export class Buttons {
  private buttons = new Map<string, Button>();
  private blockedUntil = 0;
  constructor(readonly client: ParaBusClient, private now = Date.now) { client.onChange(() => { if (client.status !== 'CONNECTED') for (const b of this.buttons.values()) b.down = undefined; this.renderAll(); }); }
  attach(id: string, kind: ButtonKind, value: unknown, sink: ButtonSink): void {
    this.remove(id);
    const b: Button = { kind, settings: kind === 'emergency' ? {} : buttonSettings(value), sink, pending: false, rendering: Promise.resolve() };
    this.buttons.set(id, b); this.render(b);
  }
  update(id: string, value: unknown): void { const b = this.buttons.get(id); if (b) { b.settings = b.kind === 'emergency' ? {} : buttonSettings(value); b.error = undefined; b.down = undefined; this.render(b); } }
  remove(id: string): void { const b = this.buttons.get(id); if (b?.timer) clearTimeout(b.timer); this.buttons.delete(id); }
  dispose(): void { for (const id of this.buttons.keys()) this.remove(id); }
  settings(id: string): ButtonSettings { return this.buttons.get(id)?.settings ?? {}; }
  async keyDown(id: string): Promise<void> {
    const b = this.buttons.get(id); if (!b) return;
    if (b.kind !== 'selector') { await this.press(id); return; }
    if (b.down) return;
    if (this.client.status !== 'CONNECTED' || !this.client.state) { this.client.connectOnPress(); this.render(b); return; }
    b.down = { at: this.now(), instanceId: this.client.state.instanceId, settings: JSON.stringify(b.settings) };
  }
  async keyUp(id: string): Promise<void> {
    const b = this.buttons.get(id), down = b?.down; if (!b || !down) return;
    b.down = undefined;
    if (this.client.status !== 'CONNECTED' || this.client.state?.instanceId !== down.instanceId || down.settings !== JSON.stringify(b.settings)) return;
    await this.press(id, Math.max(0, this.now() - down.at));
  }
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
  async press(id: string, heldMs = 0): Promise<void> {
    const b = this.buttons.get(id); if (!b) return;
    if (!configured(b.kind, b.settings)) {
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
      if (isSelector(b.kind)) {
        const selector = selectorTarget(b.settings, this.client);
        if (b.kind === 'selector-off') { await this.client.execute('selector.off', { selectorId: selector.selectorId }); return; }
        const busId = b.settings.busId!;
        if (!selector.sourceBusIds.includes(busId)) throw new ApiError(this.client.isLan ? 'TIER_FORBIDDEN' : 'NOT_FOUND');
        const operation = selector.mode === 'ADDITIVE' ? 'TOGGLE' : heldMs >= 500 ? selector.selectedBusIds.includes(busId) ? 'REMOVE' : 'ADD' : 'SWITCH';
        await this.client.execute('selector.select', { selectorId: selector.selectorId, busId, operation }); return;
      }
      if (this.client.status !== 'CONNECTED' || !this.client.state) throw new ApiError(this.client.status === 'CONNECTED' ? 'OFFLINE' : this.client.status);
      const settings = b.settings;
      if (this.client.isLan && !this.client.canExecute(`${settings.target}.${b.kind === 'mute' ? 'mute.toggle' : 'fader.adjust'}`)) throw new ApiError('TIER_FORBIDDEN');
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
