import { Buttons } from './buttons.ts';
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
    return {
      type: 'status', ...client.connectionSettings, status: client.status,
      ...(includeSettings ? { settings: this.buttons.settings(id) } : {}),
      users: state?.registeredUsers.map(u => ({ id: u.discordUserId,
        label: state.permissions.readDisplayNames && u.displayName ? `${u.discordUserId} · ${u.displayName}` : u.discordUserId })) ?? [],
      buses: state?.buses.map(b => ({ id: b.busId, kind: b.kind })) ?? [],
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
