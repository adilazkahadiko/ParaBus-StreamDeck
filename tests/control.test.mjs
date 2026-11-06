import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { ParaBusClient, Buttons, Inspector, buttonSettings, globalSettings, backoff, view, parseState, resolveTarget } from '../dist/test-api.mjs';
import { MockParaBus, until, fixture, userId, busId } from './mock-parabus.mjs';

class FakeClock {
  time = 0; jobs = new Map(); counter = 0;
  now = () => this.time;
  random = () => 0;
  setTimeout = (fn, ms) => { const id = ++this.counter; this.jobs.set(id, { fn, ms }); return id; };
  clearTimeout = id => this.jobs.delete(id);
  tick() { const [id, job] = this.jobs.entries().next().value; this.jobs.delete(id); this.time += job.ms; job.fn(); return job.ms; }
}
async function setup(t, ready = true) {
  const server = await new MockParaBus().start(), clock = new FakeClock(), client = new ParaBusClient(clock), buttons = new Buttons(client);
  const titles = [], images = [], sink = { async setTitle(t) { titles.push(t); }, async setImage(i) { images.push(i); } };
  t.after(async () => { client.stop(); buttons.dispose(); await server.close(); });
  const config = { port: server.port, token: server.token };
  if (ready) { client.configure(config); await until(() => client.status === 'CONNECTED', 'connected'); }
  return { server, client, clock, buttons, sink, titles, images, config };
}
const selections = [
  ['user', { target: 'channel', discordUserId: userId }, 'channel', { target: { kind: 'user', discordUserId: userId } }],
  ['slot all', { target: 'channel', participant: 'slot', index: 1 }, 'channel', { target: { kind: 'slot', scope: { kind: 'all' }, index: 1, expectedParticipantsRevision: 7 } }],
  ['slot bus', { target: 'channel', participant: 'slot', index: 1, scopeBusId: busId }, 'channel', { target: { kind: 'slot', scope: { kind: 'bus', busId }, index: 1, expectedParticipantsRevision: 7 } }],
  ['bus', { target: 'bus', busId }, 'bus', { busId }],
  ['send', { target: 'send', discordUserId: userId, busId }, 'send', { target: { kind: 'user', discordUserId: userId }, busId }],
  ['send slot', { target: 'send', participant: 'slot', index: 1, busId }, 'send', { target: { kind: 'slot', scope: { kind: 'all' }, index: 1, expectedParticipantsRevision: 7 }, busId }]
];
for (const [label, settings, prefix, args] of selections) {
  test(`mute ${label}: operation, args, latest expectedMute and new UUID per press`, async t => {
    const { server, buttons, client, sink, titles } = await setup(t);
    buttons.attach('key', 'mute', settings, sink); await buttons.press('key');
    await until(() => titles.includes('MUTED'));
    const first = server.actions[0];
    assert.equal(first.operation, `${prefix}.mute.toggle`); assert.deepEqual(first.args, { ...args, expectedMute: false });
    assert.equal(first.instanceId, client.state.instanceId); assert.match(first.requestId, /^[a-f\d-]{36}$/);
    await buttons.press('key'); await until(() => server.actions.length === 2);
    assert.equal(server.actions[1].args.expectedMute, true); assert.notEqual(first.requestId, server.actions[1].requestId);
  });
  test(`STALE ${label}: correct display from current.mute, no resend`, async t => {
    const { server, buttons, client, sink, titles } = await setup(t);
    server.actionFailure = { status: 409, code: 'STALE_REVISION', current: { mute: true } };
    buttons.attach('key', 'mute', settings, sink); await buttons.press('key'); await until(() => titles.includes('MUTED'));
    assert.equal(resolveTarget(buttonSettings(settings), client.state).mute, true);
    assert.equal(server.actions.length, 1); assert.equal(client.status, 'CONNECTED');
  });
}
const faders = [...selections.filter(([name]) => ['user', 'bus', 'send', 'slot all'].includes(name)), ['TX', { target: 'tx', profileId: 'TX01' }, 'tx', { profileId: 'TX01' }]];
for (const [label, settings, prefix, args] of faders) {
  for (const direction of ['up', 'down']) for (const step of [1, 2, 3, 6]) {
    test(`fader ${label} ${direction} ${step} dB: relative A and display`, async t => {
      const { server, buttons, client, sink, titles } = await setup(t);
      buttons.attach('key', `fader-${direction}`, { ...settings, stepDb: step }, sink);
      const start = resolveTarget(buttonSettings(settings), client.state).db;
      await buttons.press('key'); const delta = direction === 'up' ? step : -step;
      assert.equal(server.actions[0].operation, `${prefix}.fader.adjust`); assert.deepEqual(server.actions[0].args, { ...args, deltaDb: delta });
      const expected = start + delta;
      await until(() => titles.some(t => t.startsWith(`${expected > 0 ? '+' : ''}${expected} dB`)));
      assert.equal(server.actions.length, 1);
    });
  }
}
test('emergency always sends active:true, reflects WS state, never releases', async t => {
  const { server, buttons, sink, titles } = await setup(t);
  buttons.attach('key', 'emergency', { active: false, token: server.token }, sink);
  for (let i = 0; i < 2; i++) await buttons.press('key');
  assert.ok(server.actions.every(a => a.operation === 'emergency.set' && a.args.active === true));
  assert.deepEqual(buttons.settings('key'), {}); await until(() => titles.includes('EMERGENCY\nON'));
});
for (const code of ['RATE_LIMITED', 'INVALID', 'UNAUTHORIZED', 'DISABLED']) {
  test(`${code} action: fixed short display, no resend, no server message reflection`, async t => {
    const { server, buttons, client, sink, titles, clock } = await setup(t);
    server.actionFailure = { status: { RATE_LIMITED: 429, INVALID: 400, UNAUTHORIZED: 401, DISABLED: 503 }[code], code, message: server.token };
    buttons.attach('key', 'fader-up', { target: 'bus', busId }, sink); await buttons.press('key');
    const expected = { RATE_LIMITED: 'RATE\nLIMIT', INVALID: 'INVALID', UNAUTHORIZED: '401\nAUTH', DISABLED: 'DISABLED' }[code];
    await until(() => titles.includes(expected)); assert.ok(!JSON.stringify(titles).includes(server.token)); assert.equal(server.actions.length, 1);
    if (code === 'UNAUTHORIZED' || code === 'DISABLED') { assert.equal(client.status, code); assert.equal(clock.jobs.size, 0); }
    if (code === 'RATE_LIMITED') { await buttons.press('key'); assert.equal(server.actions.length, 1); }
  });
}
for (const code of ['UNAUTHORIZED', 'DISABLED']) {
  for (const where of ['HTTP', 'WS upgrade', 'WS message']) test(`${where} ${code}: latch until explicit connect`, async t => {
    const env = await setup(t, where === 'WS message'), { server, client, clock, config } = env;
    const failure = { status: code === 'UNAUTHORIZED' ? 401 : 503, code };
    if (where === 'HTTP') { server.failure = failure; client.configure(config); }
    if (where === 'WS upgrade') { server.upgradeFailure = failure; client.configure(config); }
    if (where === 'WS message') for (const ws of server.wsServer.clients) ws.send(JSON.stringify({ type: 'error', payload: { ok: false, code, message: server.token } }));
    await until(() => client.status === code); assert.equal(clock.jobs.size, 0); assert.equal(client.state, undefined);
    server.failure = server.upgradeFailure = undefined; client.configure(config); await until(() => client.status === 'CONNECTED');
  });
}
test('backoff uses 1–30 seconds, jitter, exponential growth, cap', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => backoff(i, 0)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(backoff(0, 1), 1250); assert.equal(backoff(2, 0.5), 4500); assert.equal(backoff(20, 1), 30000);
});
test('real reconnect scheduler grows across failed connections and does not replay actions', async t => {
  const { server, client, buttons, clock, sink } = await setup(t);
  buttons.attach('key', 'mute', { target: 'bus', busId }, sink); await buttons.press('key');
  server.failure = { status: 503, code: 'UNAVAILABLE' }; server.disconnect();
  await until(() => clock.jobs.size === 1);
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
    assert.equal(client.reconnectDelay, delay); clock.tick(); await until(() => clock.jobs.size === 1);
  }
  server.failure = undefined; clock.tick(); await until(() => client.status === 'CONNECTED');
  assert.equal(server.actions.length, 1); assert.ok(server.requests.filter(r => r.path.endsWith('/info')).length >= 8);
});
test('a short lived WS connection does not reset backoff; stable 30s does', async t => {
  const { server, client, clock } = await setup(t);
  for (const delay of [1000, 2000]) {
    server.disconnect(); await until(() => clock.jobs.size === 1); assert.equal(client.reconnectDelay, delay);
    clock.tick(); await until(() => client.status === 'CONNECTED');
  }
  clock.time += 30000; server.disconnect(); await until(() => clock.jobs.size === 1); assert.equal(client.reconnectDelay, 1000);
});
test('instanceId change on WS: discard state, refetch info/state, no action', async t => {
  const { server, client, clock } = await setup(t);
  server.state.instanceId = randomUUID(); server.state.revision = 1; server.broadcast();
  await until(() => clock.jobs.size === 1); assert.equal(client.state, undefined); assert.equal(client.reconnectDelay, 1000);
  clock.tick(); await until(() => client.status === 'CONNECTED');
  assert.equal(client.state.instanceId, server.state.instanceId);
  assert.equal(server.requests.filter(r => r.path.endsWith('/info')).length, 2);
  assert.equal(server.requests.filter(r => r.path.endsWith('/state')).length, 2); assert.equal(server.actions.length, 0);
});
test('disconnect, stop, and ambiguous HTTP action failure never change audio automatically', async t => {
  const { server, client, buttons, clock, sink } = await setup(t);
  server.dropAction = true; buttons.attach('key', 'fader-up', { target: 'bus', busId }, sink); await buttons.press('key');
  await until(() => clock.jobs.size === 1); assert.equal(server.actions.length, 1);
  server.dropAction = false; clock.tick(); await until(() => client.status === 'CONNECTED');
  assert.equal(server.actions.length, 1); client.stop(); assert.equal(clock.jobs.size, 0); assert.equal(server.actions.length, 1);
});
for (const code of [4001, 4003]) test(`close ${code} without reason: conservative STOPPED, no inferred result`, async t => {
  const { server, client, clock } = await setup(t); server.disconnect(code);
  await until(() => client.status === 'STOPPED'); assert.equal(clock.jobs.size, 0); assert.equal(server.actions.length, 0);
});
test('slot follows server order/revision; missing user/send never queues operations', async t => {
  const { server, buttons, client, sink } = await setup(t);
  server.state.participantsRevision++; server.state.revision++; server.broadcast();
  await until(() => client.state.participantsRevision === 8);
  buttons.attach('key', 'fader-down', { target: 'channel', participant: 'slot', index: 1, stepDb: 1 }, sink); await buttons.press('key');
  assert.equal(server.actions[0].args.target.expectedParticipantsRevision, 8);
  server.state.participants = []; server.state.revision++; server.broadcast(); await until(() => client.state.participants.length === 0);
  await buttons.press('key'); assert.equal(server.actions.length, 1);
  const s = parseState(fixture()); s.participants[0].sends = [];
  assert.throws(() => resolveTarget({ target: 'send', busId, discordUserId: userId }, s), /NOT_FOUND/);
});
test('state revision ordering ignores old state without blocking unrelated changes', async t => {
  const { server, client } = await setup(t);
  server.state.revision = 10; server.state.buses[0].masterDb = -12; server.broadcast(); await until(() => client.state.revision === 10);
  server.state.revision = 9; server.state.buses[0].masterDb = -2; server.broadcast();
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(client.state.buses[0].masterDb, -12);
});
test('wire headers: HTTP GET/POST and WS Bearer, strict loopback host, no Origin/Sec-Fetch, no URL/subprotocol token', async t => {
  const { server, client } = await setup(t); await client.execute('emergency.set', { active: true });
  for (const r of server.requests) {
    assert.ok(r.auth, 'Bearer must be present (value suppressed)'); assert.equal(r.host, `127.0.0.1:${server.port}`);
    assert.ok(!r.names.some(n => n === 'origin' || n.startsWith('sec-fetch-')));
    assert.equal(r.urlHasToken, false); assert.equal(r.protocolHasToken, false);
  }
  assert.ok(server.requests.some(r => r.ws)); assert.ok(server.requests.some(r => r.method === 'POST' && r.contentType === 'application/json'));
  await writeFile('dist/header-report.json', JSON.stringify({ node: process.version, requests: server.requests.map(r => ({
    transport: r.ws ? 'WS' : 'HTTP', method: r.method, path: r.path,
    headerNames: r.names.sort(), bearerPresent: r.auth, originPresent: r.names.includes('origin'),
    secFetchPresent: r.names.some(n => n.startsWith('sec-fetch-')), tokenInUrl: r.urlHasToken, tokenInSubprotocol: r.protocolHasToken
  })) }, null, 2));
});
test('settings allowlist, global-only token, no display names or revisions in action settings', async t => {
  const { server, buttons, client, sink } = await setup(t);
  let stored = { port: server.port, token: server.token }; const actions = [], outbound = [];
  const inspector = new Inspector(buttons, { async get() { return stored; }, async set(v) { stored = v; }, async setButton(_id, v) { actions.push(v); } });
  buttons.attach('key', 'mute', {}, sink);
  outbound.push(await inspector.message('key', { type: 'button.save', settings: { target: 'bus', busId, token: server.token, displayName: 'name', participantsRevision: 99, nested: { token: server.token } } }));
  assert.deepEqual(actions, [{ target: 'bus', busId }]);
  outbound.push(await inspector.message('key', { type: 'connection.save', port: server.port, token: server.token }));
  assert.ok(stored.token === server.token); assert.ok(!JSON.stringify(outbound).includes(server.token)); assert.ok(!JSON.stringify(actions).includes(server.token));
  await until(() => client.status === 'CONNECTED');
  outbound.push(await inspector.message('key', { type: 'connection.save', port: server.port })); assert.ok(stored.token === server.token);
  await inspector.message('key', { type: 'connection.clear' }); assert.equal(stored.token, ''); assert.equal(client.connectionSettings.tokenConfigured, false);
});
test('readDisplayNames is required and names are projected as text, never saved', async t => {
  const { server, client, buttons } = await setup(t); const unsafe = '<img src=x onerror=alert(1)>';
  server.state.registeredUsers[0].displayName = unsafe; server.state.participants[0].displayName = unsafe;
  server.state.revision++; server.broadcast(); await until(() => client.state.revision === server.state.revision);
  const inspector = new Inspector(buttons, {});
  assert.ok(!JSON.stringify(inspector.snapshot('key')).includes(unsafe));
  server.state.permissions.readDisplayNames = true; server.state.revision++; server.broadcast(); await until(() => client.state.permissions.readDisplayNames);
  assert.equal(inspector.snapshot('key').users[0].label, `${userId} · ${unsafe}`);
  assert.deepEqual(buttonSettings({ target: 'channel', discordUserId: userId, displayName: unsafe }), { target: 'channel', participant: 'user', discordUserId: userId });
  const js = await readFile('io.github.adilazkahadiko.parabus.sdPlugin/ui/inspector.js', 'utf8');
  assert.ok(!js.includes('innerHTML')); assert.ok(!js.includes('getGlobalSettings')); assert.ok(!js.includes('fetch(')); assert.ok(js.includes('textContent = u.label'));
});
test('configuration fixes host and rejects invalid steps and numeric Discord IDs', () => {
  assert.deepEqual(globalSettings({ port: 0, host: 'example.com', token: 'bad\r\nheader' }), { port: 4175, token: '' });
  assert.deepEqual(buttonSettings({ target: 'channel', discordUserId: Number(userId), stepDb: Infinity, token: 'synthetic' }), { target: 'channel', participant: 'user' });
  for (const stepDb of [-1, 0, 7, NaN]) assert.equal(buttonSettings({ stepDb }).stepDb, undefined);
});
test('NO_BOT TX is shown explicitly and never sent to backend', async t => {
  const { server, client, buttons, sink, titles } = await setup(t);
  server.state.tx.bots[0].state = 'NO_BOT'; server.state.revision++; server.broadcast(); await until(() => client.state.tx.bots[0].state === 'NO_BOT');
  buttons.attach('key', 'fader-up', { target: 'tx', profileId: 'TX01' }, sink); await until(() => titles.includes('NO_BOT'));
  await buttons.press('key'); assert.equal(server.actions.length, 0);
});
test('a late STALE reply does not overwrite a newer WS state', async t => {
  const { server, client, buttons, sink } = await setup(t);
  server.actionDelay = 30; server.actionFailure = { status: 409, code: 'STALE_REVISION', current: { mute: true } };
  buttons.attach('key', 'mute', { target: 'bus', busId }, sink);
  const pending = buttons.press('key'); await until(() => server.actions.length === 1);
  server.state.revision++; server.broadcast(); await until(() => client.state.revision === 2); await pending;
  assert.equal(client.state.buses[0].mute, false); assert.equal(server.actions.length, 1);
});
test('changing a button during a pending toggle never applies STALE to its new target', async t => {
  const { server, client, buttons, sink } = await setup(t);
  server.actionDelay = 30; server.actionFailure = { status: 409, code: 'STALE_REVISION', current: { mute: true } };
  buttons.attach('key', 'mute', { target: 'bus', busId }, sink);
  const pending = buttons.press('key'); await until(() => server.actions.length === 1);
  buttons.update('key', { target: 'channel', discordUserId: userId }); await pending;
  assert.equal(client.state.participants[0].mute, false); assert.equal(client.state.buses[0].mute, true);
});
test('a second press during pending HTTP is rejected, never queued', async t => {
  const { server, buttons, sink, titles } = await setup(t);
  server.actionDelay = 30; buttons.attach('key', 'fader-up', { target: 'bus', busId }, sink);
  const pending = buttons.press('key'); await until(() => server.actions.length === 1); await buttons.press('key'); await pending;
  assert.equal(server.actions.length, 1); await until(() => titles.includes('BUSY'));
});
test('WS upgrade without mandatory initial state times out and reconnects without action', async t => {
  const { server, client, clock, config } = await setup(t, false); server.suppressInitialState = true; client.configure(config);
  await until(() => clock.jobs.size === 1, 'initial state timeout', 6500);
  assert.equal(client.status, 'OFFLINE'); assert.equal(client.state, undefined); assert.equal(server.actions.length, 0);
});
