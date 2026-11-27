import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { createServer as createTcpServer, connect as connectTcp } from 'node:net';
import { randomBytes, X509Certificate } from 'node:crypto';
import { ParaBusClient, Buttons, Inspector, CredentialSettings, dpapi, ApiError, parseState, parseConnectionCode, view, buttonSettings } from '../dist/test-api.mjs';
import { MockParaBus, fixture, until, busId } from './mock-parabus.mjs';
import { generateLanCertificate } from './helpers/certificate.mjs';

const team2 = 'external-bus:' + 'b'.repeat(43), selectorId = 'external-bus:' + 'c'.repeat(43);
const encode = value => 'parabus1:' + Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const connection = () => ({ v: 1, address: '192.0.2.94', port: 4176, token: randomBytes(32).toString('base64url'), fingerprint: 'a'.repeat(64) });
function selectorState(mode = 'SWITCH') {
  const raw = fixture(); raw.buses.push({ ...raw.buses[0], busId: team2 });
  raw.selectors = [{ selectorId, name: 'Director', mode, fadeMs: 300, sourceBusIds: [busId, team2], selectedBusIds: [busId], primaryBusId: mode === 'SWITCH' ? busId : null, emergencyMuted: false }];
  return raw;
}

test('parabus1 parser validates schema, canonical encoding, duplicate keys, IP, port, token and fingerprint without echoing inputs', () => {
  const value = connection(), parsed = parseConnectionCode(encode(value)); assert.equal(parsed.token === value.token, true);
  const { token: _expected, ...metadata } = value, { token: _actual, ...parsedMetadata } = parsed; assert.deepEqual(parsedMetadata, metadata);
  const invalid = [null, '', encode({ ...value, v: 2 }), encode({ ...value, address: '0.0.0.0' }), encode({ ...value, address: '::1' }), encode({ ...value, address: 'example.com' }), encode({ ...value, port: 65536 }), encode({ ...value, token: 'bad' }), encode({ ...value, fingerprint: 'bad' }), encode({ ...value, extra: 1 }), encode(value) + '=', encode(JSON.stringify(value).replace('"v":1', '"v":1,"v":1')), encode(JSON.stringify(value).replace('"v":1', '"v":1,"\\u0076":1'))];
  for (const code of invalid) {
    let error; try { parseConnectionCode(code); } catch (e) { error = e; }
    assert.equal(error?.code, 'INVALID'); assert.equal(error.message.includes(value.token), false);
  }
});

test('inspector validates code, exposes only endpoint/pin and changes IP without replacing credentials or pin', async t => {
  const client = new ParaBusClient(), buttons = new Buttons(client); t.after(() => { client.stop(); buttons.dispose(); });
  let stored = {}, configured; client.configure = value => { configured = value; };
  const inspector = new Inspector(buttons, { get: async () => stored, set: async value => { stored = value; }, setButton: async () => {} });
  const value = connection(), code = encode(value);
  const preview = await inspector.message('key', { type: 'connection.preview', code });
  assert.deepEqual(preview, { type: 'connection-preview', address: value.address, port: value.port, fingerprint: value.fingerprint });
  assert.equal(JSON.stringify(preview).includes(value.token), false);
  await inspector.message('key', { type: 'connection.save', mode: 'lan', code });
  await inspector.message('key', { type: 'connection.save', mode: 'lan', address: '192.0.2.89' });
  assert.equal(configured.address, '192.0.2.89'); assert.equal(configured.token === value.token, true); assert.equal(configured.fingerprint, value.fingerprint);
  await assert.rejects(inspector.message('key', { type: 'connection.save', mode: 'lan', address: '0.0.0.0' }), /INVALID/);
  assert.equal(stored.address, '192.0.2.89'); assert.equal(Object.hasOwn(stored, 'code'), false);
});

async function tlsFixture(t, address = '127.0.0.1', clock) {
  const material = await generateLanCertificate('127.0.0.1'), mock = new MockParaBus(), upgrade = mock.server.listeners('upgrade')[0];
  mock.server = createServer({ cert: material.certificate, key: material.key, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, (req, res) => { void mock.http(req, res); });
  mock.address = address; mock.server.on('upgrade', upgrade); await mock.start();
  const client = new ParaBusClient(clock), target = { mode: 'lan', address, port: mock.port, token: mock.token, fingerprint: new X509Certificate(material.certificate).fingerprint256.replaceAll(':', '').toLowerCase() };
  t.after(async () => { client.stop(); await mock.close(); });
  return { mock, client, target };
}
for (const mode of ['reset', 'close']) test(`handshake ${mode} is OFFLINE, automatically backs off and reconnects after the correct TLS server returns`, async t => {
  const jobs = new Map(); let sequence = 0, now = 0;
  const clock = { now: () => now, random: () => 0,
    setTimeout: (fn, ms) => { const id = ++sequence; jobs.set(id, { fn, ms }); return id; }, clearTimeout: id => jobs.delete(id) };
  const { mock, client, target } = await tlsFixture(t, '127.0.0.1', clock), backendPort = target.port;
  let recovered = false, attempts = 0; const sockets = new Set();
  const gate = createTcpServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); attempts++;
    if (!recovered) { socket.once('data', () => mode === 'reset' ? socket.resetAndDestroy() : socket.end()); return; }
    const upstream = connectTcp({ host: '127.0.0.1', port: backendPort }); sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream)); upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
    socket.pipe(upstream); upstream.pipe(socket);
  });
  await new Promise(resolve => gate.listen(0, '127.0.0.1', resolve));
  t.after(async () => { client.stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => gate.close(resolve)); });
  mock.port = gate.address().port; client.configure({ ...target, port: mock.port });
  await until(() => client.status === 'OFFLINE');
  assert.equal(client.reconnectDelay, 1000); assert.equal(jobs.size, 1); assert.equal(mock.requests.length, 0);
  const retry = () => { const [id, job] = jobs.entries().next().value; jobs.delete(id); now += job.ms; job.fn(); };
  retry(); await until(() => attempts === 2 && client.status === 'OFFLINE');
  assert.equal(client.reconnectDelay, 2000); assert.equal(jobs.size, 1); assert.equal(mock.requests.length, 0);
  recovered = true; retry(); await until(() => client.status === 'CONNECTED');
  assert.ok(attempts >= 5); assert.ok(mock.requests.some(request => request.ws && request.auth)); assert.equal(jobs.size, 0);
});
test('an IPv4 override reaches the new address over HTTPS and WSS while retaining the original certificate pin', async t => {
  const { mock, client, target } = await tlsFixture(t, '127.0.0.2');
  const code = encode({ v: 1, ...target, mode: undefined, address: '127.0.0.1' });
  let stored = {}; const buttons = new Buttons(client); t.after(() => buttons.dispose());
  const inspector = new Inspector(buttons, { get: async () => stored, set: async value => { stored = value; }, setButton: async () => {} });
  await inspector.message('key', { type: 'connection.save', mode: 'lan', code, address: '127.0.0.2' });
  await until(() => client.status === 'CONNECTED'); assert.equal(stored.fingerprint, target.fingerprint);
  assert.ok(mock.requests.every(req => req.host === `127.0.0.2:${mock.port}`)); assert.ok(mock.requests.some(req => req.ws));
});
test('pinned HTTPS and WSS connect with TLS 1.3 and existing mute/fader actions work on LAN', async t => {
  const { mock, client, target } = await tlsFixture(t);
  client.configure(target); await until(() => client.status === 'CONNECTED');
  assert.ok(mock.requests.some(req => req.ws && req.auth)); assert.ok(mock.requests.every(req => req.host === `127.0.0.1:${mock.port}`));
  await client.execute('bus.mute.toggle', { busId, expectedMute: false });
  await client.execute('bus.fader.adjust', { busId, deltaDb: 1 });
  assert.deepEqual(mock.actions.map(action => action.operation), ['bus.mute.toggle', 'bus.fader.adjust']);
});
test('wrong HTTPS fingerprint sends no HTTP request or token and halts with certificate warning', async t => {
  const { mock, client, target } = await tlsFixture(t);
  client.configure({ ...target, fingerprint: '0'.repeat(64) }); await until(() => client.status === 'CERTIFICATE');
  assert.equal(mock.requests.length, 0); client.connectOnPress(); assert.equal(client.status, 'CERTIFICATE');
});
test('WSS independently checks the certificate before sending its upgrade Authorization', async t => {
  const { mock, client, target } = await tlsFixture(t), different = await generateLanCertificate('127.0.0.1');
  mock.beforeState = () => mock.server.setSecureContext({ cert: different.certificate, key: different.key });
  client.configure(target); await until(() => client.status === 'CERTIFICATE');
  assert.equal(mock.requests.length, 2); assert.ok(mock.requests.every(req => !req.ws));
});
test('expired pinned certificate sends no credentials', async t => {
  const { mock, client, target } = await tlsFixture(t);
  const expired = await generateLanCertificate('127.0.0.1', new Date('2000-01-01T00:00:00Z'));
  mock.server.setSecureContext({ cert: expired.certificate, key: expired.key });
  client.configure({ ...target, fingerprint: new X509Certificate(expired.certificate).fingerprint256.replaceAll(':', '').toLowerCase() });
  await until(() => client.status === 'CERTIFICATE'); assert.equal(mock.requests.length, 0);
});
test('LAN selector-only state accepts absent participants and DSP data; missing operations show permission denied', async t => {
  const { mock, client, target } = await tlsFixture(t), raw = selectorState();
  mock.operations = [];
  mock.state = { instanceId: raw.instanceId, revision: raw.revision, enabled: true, emergencyMuted: false, permissions: raw.permissions,
    selectors: raw.selectors, buses: raw.buses.map(({ busId }) => ({ busId })) };
  client.configure(target); await until(() => client.status === 'CONNECTED');
  assert.equal(client.state.selectors[0].name, 'Director'); assert.deepEqual(client.state.participants, []);
  await assert.rejects(client.execute('selector.select', { selectorId, busId, operation: 'SWITCH' }), /TIER_FORBIDDEN/);
  assert.equal(view('selector', { selectorId, busId }, client).title, '権限なし');
  assert.equal(view('selector', { selectorId: 'not-granted', busId }, client).title, '権限なし');
  assert.equal(view('mute', { target: 'send', discordUserId: '100000000000000001', busId }, client).title, '権限なし');
  assert.equal(mock.actions.length, 0);
});
test('selector-only TLS state flows through HTTPS actions and WSS lamp updates, including LOCKED and OFF', async t => {
  const { mock, client, target } = await tlsFixture(t), raw = selectorState();
  mock.operations = []; mock.extraOperations = ['selector.select', 'selector.off'];
  mock.state = { instanceId: raw.instanceId, revision: raw.revision, enabled: true, emergencyMuted: false, permissions: raw.permissions,
    selectors: raw.selectors, buses: raw.buses.map(({ busId }) => ({ busId })) };
  client.configure(target); await until(() => client.status === 'CONNECTED');
  const buttons = new Buttons(client), titles = [], sink = { async setTitle(value) { titles.push(value); }, async setImage() {} }; t.after(() => buttons.dispose());
  buttons.attach('key', 'selector', { selectorId, busId: team2 }, sink);
  await buttons.press('key', 500); await until(() => titles.includes('Team 2\n＋ ON'));
  await buttons.press('key', 500); await until(() => !client.state.selectors[0].selectedBusIds.includes(team2));
  await buttons.press('key'); await until(() => titles.includes('Team 2\nON'));
  await buttons.press('key', 500); await until(() => titles.includes('OFFを使用'));
  buttons.attach('off', 'selector-off', { selectorId }, sink); await buttons.press('off'); await until(() => client.state.selectors[0].selectedBusIds.length === 0);
  assert.deepEqual(mock.actions.map(action => action.operation === 'selector.off' ? 'OFF' : action.args.operation), ['ADD', 'REMOVE', 'SWITCH', 'REMOVE', 'OFF']);
});

function buttonsFixture(t, mode = 'SWITCH') {
  const client = new ParaBusClient(); client.status = 'CONNECTED'; client.state = parseState(selectorState(mode));
  let now = 0; const buttons = new Buttons(client, () => now), calls = [], titles = [], images = [];
  const sink = { async setTitle(title) { titles.push(title); }, async setImage(image) { images.push(image); } };
  client.execute = async (operation, args) => { calls.push({ operation, args }); };
  buttons.attach('key', 'selector', { selectorId, busId: team2 }, sink);
  t.after(() => { buttons.dispose(); client.stop(); });
  return { client, buttons, calls, sink, titles, images, advance: ms => { now += ms; } };
}
test('selector 499ms release SWITCHes, 500ms release ADDs/REMOVEs; no operation occurs on keyDown', async t => {
  const f = buttonsFixture(t);
  await f.buttons.keyDown('key'); assert.equal(f.calls.length, 0); f.advance(499); await f.buttons.keyUp('key');
  await f.buttons.keyDown('key'); f.advance(500); await f.buttons.keyUp('key');
  f.client.state.selectors[0].selectedBusIds.push(team2);
  await f.buttons.keyDown('key'); f.advance(500); await f.buttons.keyUp('key'); await f.buttons.keyUp('key');
  assert.deepEqual(f.calls.map(call => call.args.operation), ['SWITCH', 'ADD', 'REMOVE']);
  assert.ok(f.calls.every(call => call.operation === 'selector.select' && call.args.selectorId === selectorId && call.args.busId === team2));
});
test('additive selector TOGGLEs on each release regardless of press length, and OFF uses selector.off', async t => {
  const f = buttonsFixture(t, 'ADDITIVE');
  await f.buttons.keyDown('key'); f.advance(10); await f.buttons.keyUp('key');
  await f.buttons.keyDown('key'); f.advance(1000); await f.buttons.keyUp('key');
  f.buttons.attach('off', 'selector-off', { selectorId }, f.sink); await f.buttons.keyDown('off');
  assert.deepEqual(f.calls, [{ operation: 'selector.select', args: { selectorId, busId: team2, operation: 'TOGGLE' } }, { operation: 'selector.select', args: { selectorId, busId: team2, operation: 'TOGGLE' } }, { operation: 'selector.off', args: { selectorId } }]);
});
test('selector lamps, overlays, names permissions, LOCKED instruction and offline state', async t => {
  const f = buttonsFixture(t), settings = { selectorId, busId: team2 };
  assert.equal(view('selector', settings, f.client).title, 'Team 2\nOFF');
  f.client.state.selectors[0].selectedBusIds.push(team2);
  assert.equal(view('selector', settings, f.client).title, 'Team 2\n＋ ON'); assert.equal(view('selector', settings, f.client).image, 'imgs/open.svg');
  f.client.state.selectors[0].primaryBusId = team2; assert.equal(view('selector', settings, f.client).title, 'Team 2\nON');
  f.client.state.buses[1].label = 'Demo'; assert.equal(view('selector', settings, f.client).title, 'Team 2\nON');
  f.client.state.permissions.readDisplayNames = true; assert.equal(view('selector', settings, f.client).title, 'Demo\nON');
  f.client.execute = async () => { throw new ApiError('LOCKED'); }; await f.buttons.press('key', 500);
  await until(() => f.titles.includes('OFFを使用'));
  f.client.status = 'OFFLINE'; assert.equal(view('selector', settings, f.client).title, 'OFFLINE');
});
test('held selector press is discarded on settings change or disconnection; offline presses never replay', async t => {
  const f = buttonsFixture(t); await f.buttons.keyDown('key'); f.buttons.update('key', { selectorId, busId }); f.advance(800); await f.buttons.keyUp('key');
  assert.equal(f.calls.length, 0);
  await f.buttons.keyDown('key'); f.client.stop(); await f.buttons.keyUp('key'); assert.equal(f.calls.length, 0);
  await f.buttons.keyDown('key'); f.client.status = 'CONNECTED'; f.client.state = parseState(selectorState()); await f.buttons.keyUp('key'); assert.equal(f.calls.length, 0);
});
test('selector action settings only retain IDs, not API names, credentials or transient state', () => {
  assert.deepEqual(buttonSettings({ selectorId, busId, token: 'synthetic', sourceBusIds: [busId], selectedBusIds: [busId], name: 'Demo' }), { selectorId, busId });
});

test('DPAPI protects persisted tokens, restores them, migrates legacy settings and never writes plaintext or a connection code', async () => {
  let stored = {}, writes = []; const store = { get: async () => stored, set: async value => { stored = value; writes.push(value); } };
  const vault = new CredentialSettings(store), value = connection();
  await vault.set({ mode: 'lan', address: value.address, port: value.port, token: value.token, fingerprint: value.fingerprint });
  assert.equal(stored.protectedToken.startsWith('dpapi:v1:'), true); assert.equal(JSON.stringify(stored).includes(value.token), false);
  assert.equal((await vault.get()).token === value.token, true);
  stored = { port: 4175, token: value.token }; const legacy = await vault.get();
  assert.equal(legacy.token === value.token, true); assert.equal(Object.hasOwn(stored, 'token'), false);
  assert.ok(writes.every(value => !Object.hasOwn(value, 'token') && !Object.hasOwn(value, 'code')));
  await vault.set({ port: 4175, token: '' }); assert.equal(Object.hasOwn(stored, 'protectedToken'), false);
});
test('new saves fail closed if DPAPI fails; legacy migration retains working settings and warns; unreadable ciphertext is never sent as a token', async () => {
  const value = connection(); let writes = 0;
  const vault = new CredentialSettings({ get: async () => ({ port: 4175, token: value.token }), set: async () => { writes++; } }, async () => { throw new Error('Synthetic failure'); });
  assert.equal((await vault.get()).token === value.token, true); assert.ok(vault.warning); assert.equal(writes, 0);
  await assert.rejects(vault.set({ port: 4175, token: value.token })); assert.equal(writes, 0);
  await assert.rejects(vault.decode({ protectedToken: 'dpapi:v1:invalid' }));
});
test('unreadable old credentials can be replaced, and overlapping save/clear requests leave no saved token', async t => {
  const client = new ParaBusClient(), buttons = new Buttons(client); t.after(() => { client.stop(); buttons.dispose(); });
  client.configure = () => {}; let stored, writes = [];
  const value = connection(), inspector = new Inspector(buttons, { get: async () => { throw new Error('Cannot decrypt'); },
    set: async value => { await new Promise(resolve => setTimeout(resolve, 10)); stored = value; writes.push(value); }, setButton: async () => {} });
  const save = inspector.message('key', { type: 'connection.save', mode: 'lan', code: encode(value) });
  const clear = inspector.message('key', { type: 'connection.clear' }); await Promise.all([save, clear]);
  assert.equal(stored.token, ''); assert.equal(writes.length, 2);
});
