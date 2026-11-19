import { Buttons } from './buttons.ts';
import { busChoices } from './display-names.ts';
import { buttonSettings, globalSettings, record, type GlobalSettings } from './settings.ts';

export interface SettingsStore {
  get(): Promise<unknown>;
  set(value: GlobalSettings): Promise<void>;
  setButton(id: string, value: ReturnType<typeof buttonSettings>): Promise<void>;
}
export class Inspector {
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
      profiles: state?.tx.bots.map(b => b.profileId) ?? []
    };
  }
  async message(id: string, value: unknown): Promise<ReturnType<Inspector['snapshot']>> {
    const msg = record(value);
    if (msg.type === 'connection.save') {
      const previous = globalSettings(await this.store.get());
      const next = globalSettings({ port: msg.port, token: typeof msg.token === 'string' && msg.token.length ? msg.token : previous.token });
      await this.store.set(next); this.buttons.client.configure(next);
    } else if (msg.type === 'connection.clear') {
      const next = { port: this.buttons.client.connectionSettings.port, token: '' };
      this.buttons.client.stop(); await this.store.set(next); this.buttons.client.configure(next);
    } else if (msg.type === 'connection.connect') {
      this.buttons.client.configure(await this.store.get());
    } else if (msg.type === 'button.save') {
      const next = buttonSettings(msg.settings);
      await this.store.setButton(id, next); this.buttons.update(id, next);
    }
    return this.snapshot(id, msg.type === 'hello' || msg.type === 'button.save');
  }
}
