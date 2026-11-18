import test from 'node:test';
import assert from 'node:assert/strict';
import { ParaBusClient, Buttons, Inspector, parseState } from '../dist/test-api.mjs';
import { fixture } from './mock-parabus.mjs';

// All names and IDs in this fixture are synthetic.
const user = (discordUserId, displayName, online = false) => ({ discordUserId, displayName, online });
function setup(t, registeredUsers = [], labels = []) {
  const client = new ParaBusClient(), buttons = new Buttons(client), raw = fixture();
  raw.permissions.readDisplayNames = true; raw.registeredUsers = registeredUsers;
  raw.buses = labels.map((label, index) => ({ busId: `synthetic-bus-${index + 1}`, kind: 'vc', label, masterDb: 0, mute: false }));
  client.state = parseState(raw);
  let global = { port: 4175, token: '' }; const saved = [];
  const inspector = new Inspector(buttons, {
    async get() { return global; }, async set(value) { global = value; }, async setButton(id, value) { saved.push({ id, value }); }
  });
  t.after(() => { buttons.dispose(); client.stop(); });
  return { client, buttons, inspector, saved, global: () => global };
}

test('duplicate participant names suffix every matching name before its online mark; unique names stay unchanged', t => {
  const { inspector } = setup(t, [
    user('100000000000001234', 'Synthetic Guest', true), user('100000000000005678', 'Synthetic Guest'),
    user('100000000000009999', 'Synthetic Solo', true)
  ]);
  assert.deepEqual(inspector.snapshot('key').users, [
    { id: '100000000000001234', label: 'Synthetic Guest (…1234) ●' },
    { id: '100000000000005678', label: 'Synthetic Guest (…5678)' },
    { id: '100000000000009999', label: 'Synthetic Solo ●' }
  ]);
});

test('participant name comparison ignores surrounding whitespace and case', t => {
  const { inspector } = setup(t, [
    user('100000000000001234', 'Synthetic Guest'), user('100000000000005678', ' synthetic GUEST '),
    user('100000000000009999', '\tSYNTHETIC GUEST\t')
  ]);
  assert.deepEqual(inspector.snapshot('key').users.map(u => u.label), [
    'Synthetic Guest (…1234)', ' synthetic GUEST  (…5678)', 'SYNTHETIC GUEST (…9999)'
  ]);
});

test('matching last four digits use full IDs only within the duplicate name group', t => {
  const { inspector } = setup(t, [
    user('100000000000001234', 'Synthetic Guest', true), user('200000000000001234', 'Synthetic Guest'),
    user('100000000000005678', 'Synthetic Guest'), user('300000000000001234', 'Synthetic Solo')
  ]);
  assert.deepEqual(inspector.snapshot('key').users.map(u => u.label), [
    'Synthetic Guest (100000000000001234) ●', 'Synthetic Guest (200000000000001234)', 'Synthetic Guest (…5678)', 'Synthetic Solo'
  ]);
});

test('unreadable names keep ID-only labels, even when underlying names are identical', t => {
  const { client, inspector } = setup(t, [
    user('100000000000001234', 'Synthetic Guest', true), user('100000000000005678', 'Synthetic Guest')
  ]);
  client.state.permissions.readDisplayNames = false;
  assert.deepEqual(inspector.snapshot('key').users.map(u => u.label), ['100000000000001234', '100000000000005678']);
  client.state.permissions.readDisplayNames = true;
  delete client.state.registeredUsers[0].displayName; delete client.state.registeredUsers[1].displayName;
  assert.deepEqual(inspector.snapshot('key').users.map(u => u.label), ['100000000000001234', '100000000000005678']);
});

test('duplicate Bus labels use sequential display numbers while preserving IDs and unique labels', t => {
  const { client, inspector } = setup(t, [], ['Synthetic Mix', 'Synthetic Cue', 'Synthetic Mix', 'Synthetic Mix']);
  assert.deepEqual(inspector.snapshot('key').buses.map(b => b.label), ['Synthetic Mix', 'Synthetic Cue', 'Synthetic Mix (2)', 'Synthetic Mix (3)']);
  assert.deepEqual(inspector.snapshot('key').buses.map(b => b.id), client.state.buses.map(b => b.busId));
  assert.deepEqual(client.state.buses.map(b => b.label), ['Synthetic Mix', 'Synthetic Cue', 'Synthetic Mix', 'Synthetic Mix']);
  client.state.permissions.readDisplayNames = false;
  assert.deepEqual(inspector.snapshot('key').buses.map(b => b.label), ['VC Bus 1', 'VC Bus 2', 'VC Bus 3', 'VC Bus 4']);
});

test('generated Bus suffixes do not collide with existing labels', t => {
  const { inspector } = setup(t, [], ['Synthetic Mix', 'Synthetic Mix', 'Synthetic Mix (2)', 'Synthetic Mix']);
  assert.deepEqual(inspector.snapshot('key').buses.map(b => b.label), ['Synthetic Mix', 'Synthetic Mix (3)', 'Synthetic Mix (2)', 'Synthetic Mix (4)']);
});

test('disambiguation changes only PI strings, never action/global settings or source state', async t => {
  const id = '100000000000001234', { client, buttons, inspector, saved, global } = setup(t, [
    user(id, 'Synthetic Guest', true), user('100000000000005678', 'Synthetic Guest')
  ], ['Synthetic Mix', 'Synthetic Mix']);
  const stateBefore = structuredClone(client.state), options = inspector.snapshot('key');
  buttons.attach('key', 'mute', {}, { async setTitle() {}, async setImage() {} });
  const settings = { target: 'send', participant: 'user', discordUserId: id, busId: options.buses[1].id, stepDb: 2 };
  await inspector.message('key', { type: 'button.save', settings: { ...settings,
    displayName: options.users[0].label, label: options.buses[1].label, users: options.users, buses: options.buses } });
  assert.deepEqual(saved, [{ id: 'key', value: settings }]);
  assert.deepEqual(buttons.settings('key'), settings);
  assert.deepEqual(client.state, stateBefore);
  const slot = { target: 'send', participant: 'slot', index: 2, scopeBusId: options.buses[1].id, busId: options.buses[0].id, stepDb: 1 };
  await inspector.message('key', { type: 'button.save', settings: { ...slot, label: options.buses[1].label } });
  assert.deepEqual(saved.at(-1).value, slot);
  await inspector.message('key', { type: 'connection.save', port: 4175, displayName: options.users[0].label,
    label: options.buses[1].label, users: options.users, buses: options.buses });
  assert.deepEqual(global(), { port: 4175, token: '' });
  assert.ok(!JSON.stringify({ saved, global: global() }).includes('Synthetic'));
});

test('PI snapshot exposes state availability independently of empty user and Bus lists', t => {
  const { client, inspector } = setup(t);
  assert.equal(inspector.snapshot('key').hasState, true);
  client.state = undefined;
  assert.equal(inspector.snapshot('key').hasState, false);
  assert.deepEqual(inspector.snapshot('key').users, []);
  assert.deepEqual(inspector.snapshot('key').buses, []);
});
