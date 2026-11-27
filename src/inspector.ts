import { Buttons } from './buttons.ts';
import { busChoices } from './display-names.ts';
import { buttonSettings, globalSettings, record, type GlobalSettings } from './settings.ts';
import { teamChoices } from './buttons.ts';
import { parseConnectionCode, validAddress } from './lan.ts';
import { ApiError } from './protocol.ts';

export interface SettingsStore {
  warning?: string;
  get(): Promise<unknown>;
  set(value: GlobalSettings): Promise<void>;
  setButton(id: string, value: ReturnType<typeof buttonSettings>): Promise<void>;
}
export class Inspector {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private buttons: Buttons, private store: SettingsStore) {}
  snapshot(id: string, includeSettings = false) {
    const client = this.buttons.client, state = client.state;
    const names = new Map<string, string[]>();
    if (state?.permissions.readDisplayNames) for (const user of state.registeredUsers) if (user.displayName) {
      const key = user.displayName.trim().toLowerCase(), group = names.get(key) ?? [];
      group.push(user.discordUserId); names.set(key, group);
    }
    const users = state?.registeredUsers.map(user => {
      if (!state.permissions.readDisplayNames || !user.displayName) return { id: user.discordUserId, label: user.discordUserId };
      const group = names.get(user.displayName.trim().toLowerCase())!, tail = user.discordUserId.slice(-4);
      const suffix = group.length > 1 ? ` (${group.filter(id => id.endsWith(tail)).length > 1 ? user.discordUserId : `…${tail}`})` : '';
      return { id: user.discordUserId, label: `${user.displayName}${suffix}${user.online ? ' ●' : ''}` };
    }) ?? [];
    const buses = state ? busChoices(state) : [];
    return {
      type: 'status', ...client.connectionSettings, status: client.status, hasState: state !== undefined,
      ...(includeSettings ? { settings: this.buttons.settings(id) } : {}),
      users, buses,
      storageWarning: this.store.warning ?? '',
      selectors: state?.selectors.map(selector => ({ id: selector.selectorId, label: selector.name, mode: selector.mode, teams: teamChoices(state, selector.selectorId) })) ?? [],
      profiles: state?.tx.bots.map(b => b.profileId) ?? []
    };
  }
  message(id: string, value: unknown) {
    const result = this.pending.then(() => this.handle(id, value)); this.pending = result.catch(() => {}); return result;
  }
  private async handle(id: string, value: unknown) {
    const msg = record(value);
    if (msg.type === 'connection.preview') {
      const { address, port, fingerprint } = parseConnectionCode(msg.code);
      return { type: 'connection-preview', address, port, fingerprint };
    }
    if (msg.type === 'connection.save') {
      let previous: GlobalSettings;
      try { previous = globalSettings(await this.store.get()); }
      catch (error) {
        // Re-entry must work when a token belongs to another Windows account.
        if (!(typeof msg.code === 'string' && msg.code.length || typeof msg.token === 'string' && msg.token.length)) throw error;
        previous = globalSettings({});
      }
      let next: GlobalSettings;
      if (msg.mode === 'lan') {
        const parsed = typeof msg.code === 'string' && msg.code.length ? parseConnectionCode(msg.code) : undefined;
        if (!parsed && previous.mode !== 'lan') throw new ApiError('INVALID');
        const address = typeof msg.address === 'string' && msg.address.length ? msg.address : parsed?.address ?? previous.address;
        if (!validAddress(address)) throw new ApiError('INVALID');
        next = { mode: 'lan', address, port: parsed?.port ?? previous.port, fingerprint: parsed?.fingerprint ?? previous.fingerprint, token: parsed?.token ?? previous.token };
      } else next = globalSettings({ port: msg.port, token: typeof msg.token === 'string' && msg.token.length ? msg.token : previous.mode === 'lan' ? '' : previous.token });
      await this.store.set(next); this.buttons.client.configure(next);
    } else if (msg.type === 'connection.clear') {
      this.buttons.client.stop(); await this.store.set({ port: this.buttons.client.connectionSettings.port, token: '' }); this.buttons.client.configure({ port: this.buttons.client.connectionSettings.port, token: '' });
    } else if (msg.type === 'connection.connect') {
      this.buttons.client.configure(await this.store.get());
    } else if (msg.type === 'button.save') {
      const next = buttonSettings(msg.settings);
      await this.store.setButton(id, next); this.buttons.update(id, next);
    }
    return this.snapshot(id, msg.type === 'hello' || msg.type === 'button.save');
  }
}
