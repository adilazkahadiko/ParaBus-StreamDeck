import streamDeck, { action, SingletonAction, type WillAppearEvent, type WillDisappearEvent, type DidReceiveSettingsEvent, type KeyDownEvent, type SendToPluginEvent, type PropertyInspectorDidAppearEvent, type PropertyInspectorDidDisappearEvent } from '@elgato/streamdeck';
import { Buttons, type ButtonKind } from './buttons.ts';
import { ParaBusClient } from './client.ts';
import { Inspector } from './inspector.ts';
import { buttonSettings, type ButtonSettings } from './settings.ts';
import { privateLogging } from './private-logging.ts';

privateLogging(streamDeck.logger);
const client = new ParaBusClient(), buttons = new Buttons(client);
let visibleInspector: string | undefined;
const inspector = new Inspector(buttons, {
  get: () => streamDeck.settings.getGlobalSettings(),
  set: settings => streamDeck.settings.setGlobalSettings(settings),
  async setButton(id, settings) {
    const action = streamDeck.actions.getActionById(id);
    if (action) await action.setSettings(settings);
  }
});
const sendStatus = async (id: string, includeSettings = false) => {
  if (visibleInspector === id) await streamDeck.ui.sendToPropertyInspector(inspector.snapshot(id, includeSettings));
};
client.onChange(() => { if (visibleInspector) void sendStatus(visibleInspector).catch(() => {}); });
class ParaBusAction extends SingletonAction<ButtonSettings> {
  constructor(private kind: ButtonKind) { super(); }
  override async onWillAppear(ev: WillAppearEvent<ButtonSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const settings = this.kind === 'emergency' ? {} : buttonSettings(ev.payload.settings);
    buttons.attach(ev.action.id, this.kind, settings, ev.action);
    if (JSON.stringify(settings) !== JSON.stringify(ev.payload.settings)) await ev.action.setSettings(settings);
  }
  override onWillDisappear(ev: WillDisappearEvent<ButtonSettings>): void { buttons.remove(ev.action.id); }
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ButtonSettings>): Promise<void> {
    const clean = this.kind === 'emergency' ? {} : buttonSettings(ev.payload.settings);
    buttons.update(ev.action.id, clean);
    if (JSON.stringify(clean) !== JSON.stringify(ev.payload.settings)) await ev.action.setSettings(clean);
  }
  override async onKeyDown(ev: KeyDownEvent<ButtonSettings>): Promise<void> { await buttons.press(ev.action.id); }
  override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<ButtonSettings>): Promise<void> { visibleInspector = ev.action.id; await sendStatus(ev.action.id, true); }
  override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<ButtonSettings>): void { if (visibleInspector === ev.action.id) visibleInspector = undefined; }
  override async onSendToPlugin(ev: SendToPluginEvent<never, ButtonSettings>): Promise<void> {
    visibleInspector = ev.action.id;
    try { await streamDeck.ui.sendToPropertyInspector(await inspector.message(ev.action.id, ev.payload)); }
    catch { await streamDeck.ui.sendToPropertyInspector({ type: 'save-error', status: 'UNAVAILABLE' }); }
  }
}
@action({ UUID: 'io.github.adilazkahadiko.parabus.mute' })
class Mute extends ParaBusAction { constructor() { super('mute'); } }
@action({ UUID: 'io.github.adilazkahadiko.parabus.fader-up' })
class FaderUp extends ParaBusAction { constructor() { super('fader-up'); } }
@action({ UUID: 'io.github.adilazkahadiko.parabus.fader-down' })
class FaderDown extends ParaBusAction { constructor() { super('fader-down'); } }
@action({ UUID: 'io.github.adilazkahadiko.parabus.emergency' })
class Emergency extends ParaBusAction { constructor() { super('emergency'); } }
streamDeck.actions.registerAction(new Mute());
streamDeck.actions.registerAction(new FaderUp());
streamDeck.actions.registerAction(new FaderDown());
streamDeck.actions.registerAction(new Emergency());
streamDeck.settings.onDidReceiveGlobalSettings(ev => client.configure(ev.settings));
function stop(): void { client.stop(); buttons.dispose(); }
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
// Retain visible buttons so a later press can reconnect without replaying any action.
process.on('unhandledRejection', () => { client.stop(); });
await streamDeck.connect();
client.configure(await streamDeck.settings.getGlobalSettings());
