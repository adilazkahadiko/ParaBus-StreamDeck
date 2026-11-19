import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ParaBusClient, Buttons, Inspector, parseState, view, buttonName, BUTTON_NAME_WIDTH } from '../dist/test-api.mjs';
import { fixture, MockParaBus, until, userId, busId } from './mock-parabus.mjs';

// Every name, ID and state here is synthetic. No real app or device is used.
const send = { target: 'send', participant: 'user', discordUserId: userId, busId };
const bus = { target: 'bus', busId };
function state() {
  const raw = fixture();
  raw.permissions.readDisplayNames = true;
  raw.registeredUsers[0].displayName = 'DemoA';
  raw.participants[0].displayName = 'DemoB';
  raw.buses[0].label = 'MixA';
  return parseState(raw);
}
const connected = state => ({ status: 'CONNECTED', state });
const title = (state, settings = send, kind = 'mute') => view(kind, settings, connected(state)).title;

test('user title prefers registeredUsers and includes current mute state', () => {
  const s = state();
  assert.equal(title(s), 'DemoA\nOPEN');
  s.participants[0].sends[0].mute = true;
  assert.equal(title(s), 'DemoA\nMUTED');
  assert.equal(s.registeredUsers[0].displayName, 'DemoA');
});

test('user title falls back to participants, then the last four ID digits', () => {
  const s = state();
  delete s.registeredUsers[0].displayName;
  assert.equal(title(s), 'DemoB\nOPEN');
  s.registeredUsers[0].displayName = '\n\x00\u0085';
  assert.equal(title(s), 'DemoB\nOPEN');
  s.registeredUsers = [];
  assert.equal(title(s), 'DemoB\nOPEN');
  delete s.participants[0].displayName;
  assert.equal(title(s), `…${userId.slice(-4)}\nOPEN`);
});

test('unreadable user names are ignored even if still present in memory', () => {
  const s = state(); s.permissions.readDisplayNames = false;
  assert.equal(title(s), `…${userId.slice(-4)}\nOPEN`);
});

test('all and Bus slots use their current occupant and retain empty-slot errors', () => {
  const s = state(), secondId = '100000000000000002';
  s.participants.push({ discordUserId: secondId, displayName: 'DemoC', sends: [{ busId, db: 0, mute: true }] });
  const slot = { target: 'send', participant: 'slot', index: 1, busId };
  assert.equal(title(s, slot), 'DemoA\nOPEN');
  s.participantOrders[0].users[0] = secondId;
  assert.equal(title(s, slot), 'DemoC\nMUTED');
  assert.equal(title(s, { ...slot, scopeBusId: busId }), 'DemoA\nOPEN');
  s.permissions.readDisplayNames = false;
  assert.equal(title(s, slot), '…0002\nMUTED');
  s.participantOrders[0].users = [];
  assert.equal(title(s, slot), 'NO TARGET');
  assert.equal(title(s, { ...slot, index: undefined }), 'SETUP');
});

test('Bus labels, kind/order fallbacks and duplicate suffixes match inspector choices', () => {
  const s = state();
  s.buses.push({ busId: 'synthetic-bus-2', kind: 'vc', label: 'MixA', masterDb: 0, mute: false });
  s.buses.push({ busId: 'synthetic-bus-3', kind: 'other', label: 'MixA (2)', masterDb: 0, mute: false });
  const client = connected(s), inspector = new Inspector({ client, settings: () => ({}) }, {});
  assert.deepEqual(inspector.snapshot('key').buses.map(b => b.label), ['MixA', 'MixA (3)', 'MixA (2)']);
  for (const b of inspector.snapshot('key').buses) {
    assert.equal(title(s, { target: 'bus', busId: b.id }), `${b.label}\nOPEN`);
  }
  s.buses[2].label = 'MixA';
  assert.equal(title(s, { target: 'bus', busId: s.buses[1].busId }), 'MixA (2)\nOPEN');
  s.permissions.readDisplayNames = false;
  assert.deepEqual(inspector.snapshot('key').buses.map(b => b.label), ['VC Bus 1', 'VC Bus 2', 'Bus 3']);
  for (const b of inspector.snapshot('key').buses) {
    assert.equal(title(s, { target: 'bus', busId: b.id }), `${b.label}\nOPEN`);
  }
  s.permissions.readDisplayNames = true; delete s.buses[0].label;
  assert.equal(title(s, bus), 'VC Bus 1\nOPEN');
});

test('TX name is its current one-based position, not its profile ID', () => {
  const s = state(), tx = { target: 'tx', profileId: s.tx.bots[0].profileId };
  assert.equal(title(s, tx, 'fader-up'), 'TX 1\n-6 dB\n+1');
  s.tx.bots.unshift({ profileId: 'synthetic-profile', state: 'READY', masterDb: 0 });
  assert.equal(title(s, tx, 'fader-down'), 'TX 2\n-6 dB\n−1');
});

test('full-width names reserve space for ellipsis and obey the adjusted width limit', () => {
  assert.equal(BUTTON_NAME_WIDTH, 8);
  assert.equal(buttonName('試験参加者の仮名'), '試験参…');
  assert.equal(buttonName('試験参加'), '試験参加');
  assert.equal(buttonName('ABCDEFGH'), 'ABCDEFGH');
  assert.equal(buttonName('ABCDEFGHI'), 'ABCDEF…');
  assert.equal(buttonName('ｱｲｳｴｵｶｷｸ'), 'ｱｲｳｴｵｶｷｸ');
  assert.equal(buttonName('AB試験CDE'), 'AB試験…');
  assert.equal(buttonName('😀😀😀😀😀'), '😀😀😀…');
  const s = state(); s.registeredUsers[0].displayName = '試験参加者の仮名';
  assert.equal(title(s), '試験参…\nOPEN');
});

test('line breaks, C0/C1, formatting controls and Unicode line separators are removed', () => {
  const unsafe = '\x00D\te\nm\ro\x7f\u0085\u2028\u2029\u202e\u200bA';
  assert.equal(buttonName(unsafe), 'DemoA');
  const s = state(); s.registeredUsers[0].displayName = unsafe;
  assert.equal(title(s), 'DemoA\nOPEN');
  s.buses[0].label = unsafe;
  assert.equal(title(s, bus), 'DemoA\nOPEN');
});

test('faders have name, unchanged dB formatting and signed step on three lines', () => {
  const s = state();
  for (const [db, expected] of [[0, '0'], [-0, '0'], [1.25, '+1.3'], [-1.25, '-1.3']]) {
    s.participants[0].sends[0].db = db;
    assert.equal(title(s, { ...send, stepDb: 2 }, 'fader-up'), `DemoA\n${expected} dB\n+2`);
    assert.equal(title(s, { ...send, stepDb: 6 }, 'fader-down'), `DemoA\n${expected} dB\n−6`);
  }
});

test('emergency, connection errors and resolution errors retain their exact text and images', () => {
  const s = state(), client = connected(s);
  assert.deepEqual(view('emergency', {}, client), { title: 'EMERGENCY\nREADY', image: 'imgs/emergency.svg' });
  s.emergencyMuted = true;
  assert.deepEqual(view('emergency', {}, client), { title: 'EMERGENCY\nON', image: 'imgs/emergency-on.svg' });
  const errors = {
    INVALID: 'INVALID', UNAUTHORIZED: '401\nAUTH', HOST_FORBIDDEN: 'HOST', ORIGIN_FORBIDDEN: 'ORIGIN',
    TIER_FORBIDDEN: 'DENIED', NOT_FOUND: 'NO TARGET', LOCKED: 'LOCKED', STALE_REVISION: 'STALE',
    RATE_LIMITED: 'RATE\nLIMIT', DISABLED: 'DISABLED', UNAVAILABLE: 'ERROR', INTERNAL: 'ERROR',
    OFFLINE: 'OFFLINE', CONNECTING: 'CONNECT', STOPPED: 'STOPPED', CONFIGURE: 'SETUP', BUSY: 'BUSY', INCOMPATIBLE: 'API\nVERSION'
  };
  for (const kind of ['mute', 'fader-up', 'fader-down', 'emergency']) {
    for (const [error, text] of Object.entries(errors)) {
      assert.deepEqual(view(kind, send, client, error), { title: text, image: 'imgs/error.svg' });
      assert.deepEqual(view(kind, send, { status: error }), { title: text, image: 'imgs/offline.svg' });
    }
    assert.deepEqual(view(kind, send, { status: 'CONNECTED' }), { title: 'OFFLINE', image: 'imgs/offline.svg' });
  }
  assert.deepEqual(view('mute', {}, client), { title: 'SETUP', image: 'imgs/offline.svg' });
  assert.equal(title(s, { ...send, discordUserId: '100000000000009999' }), 'NO TARGET');
  assert.equal(title(s, { ...bus, busId: 'synthetic-missing-bus' }), 'NO TARGET');
  const tx = { target: 'tx', profileId: s.tx.bots[0].profileId };
  assert.equal(title(s, tx), 'INVALID');
  s.tx.bots[0].state = 'NO_BOT';
  assert.deepEqual(view('fader-up', tx, client), { title: 'NO_BOT', image: 'imgs/offline.svg' });
});

test('next state updates rename user/Bus, reassign slots and revoke names without saving settings', async t => {
  const server = await new MockParaBus().start(), client = new ParaBusClient(), buttons = new Buttons(client);
  t.after(async () => { buttons.dispose(); client.stop(); await server.close(); });
  server.state.permissions.readDisplayNames = true;
  server.state.registeredUsers[0].displayName = 'DemoA'; server.state.buses[0].label = 'MixA';
  const titles = { user: [], slot: [], bus: [] };
  const slot = { target: 'send', participant: 'slot', index: 1, busId };
  for (const [id, settings] of [['user', send], ['slot', slot], ['bus', bus]]) {
    buttons.attach(id, 'mute', settings, { async setTitle(value) { titles[id].push(value); }, async setImage() {} });
  }
  client.configure({ port: server.port, token: server.token });
  await until(() => titles.user.at(-1) === 'DemoA\nOPEN' && titles.bus.at(-1) === 'MixA\nOPEN');
  server.state.registeredUsers[0].displayName = 'DemoB'; server.state.buses[0].label = 'MixB';
  server.state.revision++; server.broadcast();
  await until(() => titles.user.at(-1) === 'DemoB\nOPEN' && titles.bus.at(-1) === 'MixB\nOPEN');
  const secondId = '100000000000000002';
  server.state.participants.push({ discordUserId: secondId, displayName: 'DemoC', sends: [{ busId, db: 0, mute: false }] });
  server.state.participantOrders[0].users[0] = secondId; server.state.participantsRevision++;
  server.state.revision++; server.broadcast();
  await until(() => titles.slot.at(-1) === 'DemoC\nOPEN');
  assert.equal(titles.user.at(-1), 'DemoB\nOPEN');
  server.state.permissions.readDisplayNames = false; server.state.revision++; server.broadcast();
  await until(() => titles.user.at(-1) === '…0001\nOPEN' && titles.slot.at(-1) === '…0002\nOPEN' && titles.bus.at(-1) === 'VC Bus 1\nOPEN');
  assert.deepEqual(buttons.settings('user'), send);
  assert.deepEqual(buttons.settings('slot'), slot);
  assert.deepEqual(buttons.settings('bus'), bus);
  assert.equal(server.actions.length, 0);
});

test('manifest keeps emergency defaults while sizing mute/fader titles for 72px keys', async () => {
  const manifest = JSON.parse(await readFile('io.github.adilazkahadiko.parabus.sdPlugin/manifest.json', 'utf8'));
  assert.equal(manifest.Version, '0.1.2.0');
  for (const action of manifest.Actions) {
    assert.equal(action.States[0].TitleAlignment, 'bottom');
    assert.equal(action.States[0].FontSize, action.UUID.endsWith('.emergency') ? 11 : 9);
    if (!action.UUID.endsWith('.emergency')) assert.equal(action.States[0].FontFamily, 'Arial');
  }
});
