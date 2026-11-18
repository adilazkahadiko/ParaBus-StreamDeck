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
  setTimeout = (fn, ms) => { const id = ++this.counter; this.jobs.set(id, { fn, ms, at: this.time + ms }); return id; };
  clearTimeout = id => this.jobs.delete(id);
  tick() { const [id, job] = this.jobs.entries().next().value; this.jobs.delete(id); this.time += job.ms; job.fn(); return job.ms; }
  advance(ms) {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.jobs.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next; this.jobs.delete(id); this.time = job.at; job.fn();
    }
    this.time = end;
  }
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
  ['bus', { target: 'bus', busId }, 'bus', { busId }],
  ['send', { target: 'send', discordUserId: userId, busId }, 'send', { target: { kind: 'user', discordUserId: userId }, busId }],
  ['send slot all', { target: 'send', participant: 'slot', index: 1, busId }, 'send', { target: { kind: 'slot', scope: { kind: 'all' }, index: 1, expectedParticipantsRevision: 7 }, busId }],
  ['send slot bus', { target: 'send', participant: 'slot', index: 1, scopeBusId: busId, busId }, 'send', { target: { kind: 'slot', scope: { kind: 'bus', busId }, index: 1, expectedParticipantsRevision: 7 }, busId }]
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
const faders = [...selections, ['TX', { target: 'tx', profileId: 'TX01' }, 'tx', { profileId: 'TX01' }]];
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
for (const kind of ['mute', 'fader-up', 'fader-down']) for (const participant of ['user', 'slot']) {
  test(`legacy channel ${kind} ${participant}: SETUP on attach/update/offline, no requests`, async t => {
    const { server, client, buttons, sink, titles } = await setup(t);
    const legacy = { target: 'channel', participant, discordUserId: userId, index: 1, scopeBusId: busId, busId, stepDb: 2 };
    assert.deepEqual(buttonSettings(legacy), { stepDb: 2 });
    assert.throws(() => resolveTarget(legacy, client.state), /CONFIGURE/);
    buttons.attach('key', kind, legacy, sink);
    await until(() => titles.at(-1) === 'SETUP');
    const requestCount = server.requests.length;
    await buttons.press('key');
    assert.equal(server.requests.length, requestCount);
    assert.equal(server.actions.length, 0);
    buttons.update('key', { target: 'bus', busId });
    await until(() => titles.at(-1) !== 'SETUP');
    buttons.update('key', legacy);
    await until(() => titles.at(-1) === 'SETUP');
    await buttons.press('key');
    client.stop();
    assert.equal(view(kind, buttons.settings('key'), client).title, 'SETUP');
    await buttons.press('key');
    assert.equal(client.status, 'STOPPED');
    assert.equal(server.requests.length, requestCount);
    assert.equal(server.actions.length, 0);
  });
}
test('state accepts participants without faderDb/mute and ignores legacy fields', () => {
  const raw = fixture(), parsed = parseState(raw);
  assert.deepEqual(parsed.participants, [{ discordUserId: userId, sends: [{ busId, db: -4, mute: false }] }]);
  raw.participants[0].faderDb = 'unused'; raw.participants[0].mute = null;
  assert.deepEqual(parseState(raw), parsed);
  assert.equal(resolveTarget({ target: 'send', discordUserId: userId, busId }, parsed).db, -4);
  delete raw.participants[0].sends[0].mute;
  assert.throws(() => parseState(raw), /UNAVAILABLE/);
});
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
    if (code === 'UNAUTHORIZED' || code === 'DISABLED') {
      assert.equal(client.status, code); assert.equal(clock.jobs.size, code === 'DISABLED' ? 1 : 0);
      if (code === 'DISABLED') assert.equal(client.reconnectDelay, 5000);
    }
    if (code === 'RATE_LIMITED') { await buttons.press('key'); assert.equal(server.actions.length, 1); }
  });
}
for (const code of ['UNAUTHORIZED', 'DISABLED']) {
  for (const where of ['HTTP', 'WS upgrade', 'WS message']) test(`${where} ${code}: ${code === 'DISABLED' ? 'poll until enabled' : 'latch until explicit connect'}`, async t => {
    const env = await setup(t, where === 'WS message'), { server, client, clock, config } = env;
    const failure = { status: code === 'UNAUTHORIZED' ? 401 : 503, code };
    if (where === 'HTTP') { server.failure = failure; client.configure(config); }
    if (where === 'WS upgrade') { server.upgradeFailure = failure; client.configure(config); }
    if (where === 'WS message') for (const ws of server.wsServer.clients) ws.send(JSON.stringify({ type: 'error', payload: { ok: false, code, message: server.token } }));
    await until(() => client.status === code); assert.equal(clock.jobs.size, code === 'DISABLED' ? 1 : 0); assert.equal(client.state, undefined);
    server.failure = server.upgradeFailure = undefined;
    if (code === 'DISABLED') { assert.equal(clock.tick(), 5000); } else client.configure(config);
    await until(() => client.status === 'CONNECTED');
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
for (const code of [4001, 4003]) test(`close ${code} without reason: ${code === 4001 ? 'HTTP authentication stop' : 'disabled polling'}, no inferred result`, async t => {
  const { server, client, clock } = await setup(t);
  if (code === 4001) server.failure = { status: 401, code: 'UNAUTHORIZED' };
  server.disconnect(code);
  await until(() => client.status === (code === 4001 ? 'UNAUTHORIZED' : 'DISABLED'));
  assert.equal(clock.jobs.size, code === 4001 ? 0 : 1); assert.equal(server.actions.length, 0);
});

test('beta.6 permission close 4001 probes state once, reconnects on 200, and stops an immediate consecutive 4001', async t => {
  const { server, client, clock } = await setup(t), baseline = server.requests.length;
  server.state.permissions.readDisplayNames = true;
  server.disconnect(4001);
  await until(() => server.requests.length > baseline && client.status === 'CONNECTED' && client.state.permissions.readDisplayNames);
  assert.deepEqual(server.requests.slice(baseline).map(r => [r.path, r.ws]), [
    ['/external/v1/state', false], ['/external/v1/info', false], ['/external/v1/state', false], ['/external/v1/ws', true]
  ]);
  assert.ok(server.requests.slice(baseline).every(r => r.auth));
  const recovered = server.requests.length;
  server.disconnect(4001); await until(() => client.status === 'UNAUTHORIZED');
  clock.advance(60000);
  assert.equal(server.requests.length, recovered); assert.equal(clock.jobs.size, 0);
  assert.equal(client.state, undefined); assert.equal(server.actions.length, 0);
});

test('4001 probe gets 401: stops after exactly one authenticated request', async t => {
  const { server, client, clock } = await setup(t), baseline = server.requests.length;
  server.failure = { status: 401, code: 'UNAUTHORIZED' }; server.disconnect(4001);
  await until(() => client.status === 'UNAUTHORIZED'); clock.advance(60000);
  assert.deepEqual(server.requests.slice(baseline).map(r => r.path), ['/external/v1/state']);
  assert.ok(server.requests[baseline].auth); assert.equal(clock.jobs.size, 0); assert.equal(server.actions.length, 0);
});

test('close 4005 refetches permissions immediately without backoff or action replay', async t => {
  const { server, client, clock } = await setup(t), baseline = server.requests.length;
  server.state.permissions.readDisplayNames = true; server.disconnect(4005);
  await until(() => client.status === 'CONNECTED' && client.state.permissions.readDisplayNames);
  assert.deepEqual(server.requests.slice(baseline).map(r => r.path), ['/external/v1/info', '/external/v1/state', '/external/v1/ws']);
  assert.equal(clock.jobs.size, 0); assert.equal(server.actions.length, 0);
});

test('three beta.6 permission changes ten seconds apart each probe and reconnect', async t => {
  const { server, client, clock } = await setup(t);
  for (const names of [true, false, true]) {
    clock.advance(10000);
    const baseline = server.requests.length;
    server.state.permissions.readDisplayNames = names; server.disconnect(4001);
    await until(() => client.status === 'CONNECTED' && client.state.permissions.readDisplayNames === names);
    assert.deepEqual(server.requests.slice(baseline).map(r => r.path), ['/external/v1/state', '/external/v1/info', '/external/v1/state', '/external/v1/ws']);
    assert.ok(server.requests.slice(baseline).every(r => r.auth));
  }
  assert.equal(server.actions.length, 0);
});

for (const elapsed of [2000, 2001]) test(`4001 at ${elapsed} ms after reconnect: ${elapsed === 2000 ? 'stop' : 'probe and reconnect'}`, async t => {
  const { server, client, clock } = await setup(t);
  let baseline = server.requests.length; server.disconnect(4001);
  await until(() => server.requests.length > baseline && client.status === 'CONNECTED');
  clock.advance(elapsed); baseline = server.requests.length; server.disconnect(4001);
  if (elapsed === 2000) {
    await until(() => client.status === 'UNAUTHORIZED'); clock.advance(60000);
    assert.equal(server.requests.length, baseline); assert.equal(client.state, undefined);
  } else {
    await until(() => server.requests.length > baseline && client.status === 'CONNECTED');
    assert.equal(server.requests.length - baseline, 4);
  }
  assert.equal(clock.jobs.size, 0); assert.equal(server.actions.length, 0);
});

test('sixth 4001 check in sixty seconds stops without another HTTP probe', async t => {
  const { server, client, clock } = await setup(t);
  for (let i = 0; i < 5; i++) {
    clock.advance(3000); const baseline = server.requests.length; server.disconnect(4001);
    await until(() => server.requests.length > baseline && client.status === 'CONNECTED');
    assert.equal(server.requests.length - baseline, 4);
  }
  clock.advance(3000); const baseline = server.requests.length; server.disconnect(4001);
  await until(() => client.status === 'UNAUTHORIZED'); clock.advance(60000);
  assert.equal(server.requests.length, baseline); assert.equal(clock.jobs.size, 0); assert.equal(server.actions.length, 0);
});

test('4001 check budget expires after sixty seconds rather than requiring a thirty-second stable connection', async t => {
  const { server, client, clock } = await setup(t);
  for (let i = 0; i < 5; i++) {
    const baseline = server.requests.length; server.disconnect(4001);
    await until(() => server.requests.length > baseline && client.status === 'CONNECTED');
    clock.advance(3000);
  }
  clock.advance(45000); // Exactly sixty seconds after the first check: it leaves the rolling window.
  const baseline = server.requests.length; server.disconnect(4001);
  await until(() => server.requests.length > baseline && client.status === 'CONNECTED');
  assert.equal(server.requests.length - baseline, 4); assert.equal(server.actions.length, 0);
});

test('presses during the 4001 HTTP check share the probe and never send or queue actions', async t => {
  const { server, client, clock, buttons, sink } = await setup(t); let release;
  server.beforeState = () => new Promise(resolve => { release = resolve; });
  t.after(() => release?.());
  const baseline = server.requests.length; server.disconnect(4001);
  await until(() => release);
  assert.equal(client.status, 'CONNECTING'); assert.equal(client.state, undefined);
  for (const kind of ['mute', 'fader-up', 'fader-down', 'emergency']) {
    buttons.attach(kind, kind, { target: 'bus', busId }, sink); await buttons.press(kind);
  }
  assert.equal(server.requests.length, baseline + 1); assert.equal(server.actions.length, 0);
  clock.advance(10000); server.beforeState = undefined; release();
  await until(() => client.status === 'CONNECTED');
  assert.equal(server.requests.length, baseline + 4); assert.equal(server.actions.length, 0);
  server.disconnect(4001); await until(() => client.status === 'UNAUTHORIZED');
  assert.equal(server.requests.length, baseline + 4); // Two-second guard starts at reconnect, not the probe.
});

test('Bus labels are optional, permission-gated, sanitized and replaced by kind/order labels', async () => {
  const raw = fixture(), label = '\x00Synthetic\nBus\x7f' + '名'.repeat(90);
  raw.buses[0].label = label;
  assert.equal(Object.hasOwn(parseState(raw).buses[0], 'label'), false);
  raw.permissions.readDisplayNames = true;
  assert.equal(parseState(raw).buses[0].label, ('SyntheticBus' + '名'.repeat(90)).slice(0, 80));
  const client = new ParaBusClient(), buttons = new Buttons(client), inspector = new Inspector(buttons, {});
  try {
    client.state = parseState(raw);
    client.state.buses.push({ busId: 'other-bus', kind: 'other', masterDb: 0, mute: false });
    assert.deepEqual(inspector.snapshot('key').buses.map(b => b.label), [('SyntheticBus' + '名'.repeat(90)).slice(0, 80), 'Bus 2']);
    delete client.state.buses[0].label;
    assert.deepEqual(inspector.snapshot('key').buses.map(b => b.label), ['VC Bus 1', 'Bus 2']);
  } finally { buttons.dispose(); client.stop(); }
});
test('slot follows server order/revision; missing user/send never queues operations', async t => {
  const { server, buttons, client, sink } = await setup(t);
  server.state.participantsRevision++; server.state.revision++; server.broadcast();
  await until(() => client.state.participantsRevision === 8);
  buttons.attach('key', 'fader-down', { target: 'send', participant: 'slot', index: 1, busId, stepDb: 1 }, sink); await buttons.press('key');
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
  assert.equal(inspector.snapshot('key').users[0].label, `${unsafe} ●`);
  assert.deepEqual(buttonSettings({ target: 'send', discordUserId: userId, busId, displayName: unsafe }), { target: 'send', participant: 'user', discordUserId: userId, busId });
  const js = await readFile('io.github.adilazkahadiko.parabus.sdPlugin/ui/inspector.js', 'utf8');
  assert.ok(!js.includes('innerHTML')); assert.ok(!js.includes('getGlobalSettings')); assert.ok(!js.includes('fetch(')); assert.ok(js.includes('new Option(user.label, user.id)'));
});

test('registered-user labels reflect permission and online status; names never enter either settings store', async t => {
  const { server, client, buttons, sink } = await setup(t);
  let stored = { port: server.port, token: server.token }; const saved = [];
  const inspector = new Inspector(buttons, { async get() { return stored; }, async set(v) { stored = v; }, async setButton(_id, v) { saved.push(v); } });
  buttons.attach('key', 'mute', {}, sink);
  client.state.permissions.readDisplayNames = true;
  client.state.registeredUsers = [
    { discordUserId: userId, displayName: 'Synthetic Online', online: true },
    { discordUserId: '100000000000000002', displayName: 'Synthetic Offline', online: false },
    { discordUserId: '100000000000000003', online: true }
  ];
  assert.deepEqual(inspector.snapshot('key').users.map(u => u.label), ['Synthetic Online ●', 'Synthetic Offline', '100000000000000003']);
  await inspector.message('key', { type: 'button.save', settings: { target: 'send', discordUserId: userId, busId, label: 'Synthetic Bus', displayName: 'Synthetic Online' } });
  assert.deepEqual(saved, [{ target: 'send', participant: 'user', discordUserId: userId, busId }]);
  await inspector.message('key', { type: 'connection.save', port: server.port, label: 'Synthetic Bus', displayName: 'Synthetic Online' });
  assert.deepEqual(Object.keys(stored).sort(), ['port', 'token']);
  assert.ok(!JSON.stringify(saved).includes('Synthetic'));
});
test('configuration fixes host and rejects invalid steps and numeric Discord IDs', () => {
  assert.deepEqual(globalSettings({ port: 0, host: 'example.com', token: 'bad\r\nheader' }), { port: 4175, token: '' });
  assert.deepEqual(buttonSettings({ target: 'send', discordUserId: Number(userId), stepDb: Infinity, token: 'synthetic' }), { target: 'send', participant: 'user' });
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
  buttons.update('key', { target: 'send', discordUserId: userId, busId }); await pending;
  assert.equal(client.state.participants[0].sends[0].mute, false); assert.equal(client.state.buses[0].mute, true);
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

for (const source of ['/info', '/state', 'WS upgrade', 'WS error', 'close 4003', 'HTTP enabled=false', 'WS enabled=false']) {
  test(`DISABLED from ${source}: fixed 5s info-only probes, stable display, automatic recovery`, async t => {
    const ready = ['WS error', 'close 4003', 'WS enabled=false'].includes(source);
    const { server, client, clock, config, buttons, sink, titles } = await setup(t, ready);
    buttons.attach('key', 'emergency', {}, sink);
    const disabled = { status: 503, code: 'DISABLED' };
    if (source === '/info') server.failure = disabled;
    if (source === '/state') server.pathFailures['/external/v1/state'] = disabled;
    if (source === 'WS upgrade') server.upgradeFailure = disabled;
    if (source === 'HTTP enabled=false' || source === 'WS enabled=false') server.state.enabled = false;
    if (!ready) client.configure(config);
    else if (source === 'WS error') for (const ws of server.wsServer.clients) ws.send(JSON.stringify({ type: 'error', payload: { ok: false, code: 'DISABLED' } }));
    else if (source === 'close 4003') server.disconnect(4003);
    else server.broadcast();
    await until(() => client.status === 'DISABLED' && clock.jobs.size === 1);
    await until(() => titles.at(-1) === 'DISABLED');
    const baseline = server.requests.length;
    const statuses = []; client.onChange(() => statuses.push(client.status));
    server.failure = disabled; clock.random = () => 1;
    for (let probe = 1; probe <= 4; probe++) {
      assert.equal(client.reconnectDelay, 5000);
      clock.advance(4999); assert.equal(server.requests.length, baseline + probe - 1);
      clock.advance(1); await until(() => server.requests.length === baseline + probe && clock.jobs.size === 1);
      assert.equal(client.status, 'DISABLED');
    }
    assert.ok(statuses.every(status => status === 'DISABLED'));
    assert.deepEqual(server.requests.slice(baseline).map(r => [r.method, r.path]), Array.from({ length: 4 }, () => ['GET', '/external/v1/info']));
    assert.equal(server.actions.length, 0);
    server.failure = server.upgradeFailure = undefined; server.pathFailures = {}; server.state.enabled = true;
    clock.advance(5000); await until(() => client.status === 'CONNECTED');
    assert.deepEqual(server.requests.slice(baseline + 4).map(r => r.path), ['/external/v1/info', '/external/v1/state', '/external/v1/ws']);
    assert.equal(server.actions.length, 0); assert.equal(clock.jobs.size, 0);
  });
}

for (const state of ['DISABLED', 'STOPPED', 'OFFLINE']) for (const kind of ['mute', 'fader-up', 'fader-down', 'emergency']) {
  test(`${kind} press while ${state}: connect immediately, consume press, never replay action`, async t => {
    const { server, client, clock, buttons, sink, titles, config } = await setup(t);
    buttons.attach('key', kind, { target: 'bus', busId }, sink);
    if (state === 'STOPPED') client.stop();
    else if (state === 'OFFLINE') { server.disconnect(); await until(() => client.status === 'OFFLINE'); }
    else {
      for (const ws of server.wsServer.clients) ws.send(JSON.stringify({ type: 'error', payload: { ok: false, code: 'DISABLED' } }));
      await until(() => client.status === 'DISABLED');
    }
    let release; server.beforeInfo = () => new Promise(resolve => { release = resolve; });
    const baseline = server.requests.length;
    await buttons.press('key'); assert.equal(client.status, 'CONNECTING');
    await until(() => server.requests.length === baseline + 1 && titles.at(-1) === 'CONNECT');
    assert.equal(clock.jobs.size, 0); assert.equal(server.requests.at(-1).path, '/external/v1/info'); assert.equal(server.actions.length, 0);
    release(); server.beforeInfo = undefined;
    await until(() => client.status === 'CONNECTED');
    assert.equal(server.actions.length, 0);
    assert.deepEqual(server.requests.slice(baseline).map(r => r.path), ['/external/v1/info', '/external/v1/state', '/external/v1/ws']);
    clock.advance(30000); assert.equal(server.actions.length, 0); assert.equal(clock.jobs.size, 0);
    // A separate press, after the connection is established, remains an ordinary action.
    await buttons.press('key'); assert.equal(server.actions.length, 1);
  });
}

for (const source of ['UNAUTHORIZED', 'close 4001', 'CONFIGURE']) {
  test(`${source}: no automatic retry or connection on any button press`, async t => {
    const { server, client, clock, buttons, sink, config } = await setup(t);
    if (source === 'UNAUTHORIZED') {
      server.failure = { status: 401, code: 'UNAUTHORIZED' }; client.configure(config); await until(() => client.status === 'UNAUTHORIZED');
    } else if (source === 'close 4001') {
      server.failure = { status: 401, code: 'UNAUTHORIZED' };
      server.disconnect(4001); await until(() => client.status === 'UNAUTHORIZED');
    } else client.configure({ port: server.port, token: '' });
    const baseline = server.requests.length;
    for (const kind of ['mute', 'fader-up', 'fader-down', 'emergency']) {
      buttons.attach(kind, kind, { target: 'bus', busId }, sink); await buttons.press(kind);
    }
    clock.advance(60000); assert.equal(server.requests.length, baseline); assert.equal(clock.jobs.size, 0); assert.equal(server.actions.length, 0);
  });
}

test('DISABLED display persists during a pending probe and temporary connection failures', async t => {
  const { server, client, clock, config } = await setup(t, false);
  server.failure = { status: 503, code: 'DISABLED' }; client.configure(config);
  await until(() => client.status === 'DISABLED');
  let release; server.beforeInfo = () => new Promise(resolve => { release = resolve; });
  clock.advance(5000); await until(() => release); assert.equal(client.status, 'DISABLED');
  server.failure = { status: 503, code: 'UNAVAILABLE' }; release(); server.beforeInfo = undefined;
  await until(() => clock.jobs.size === 1);
  assert.equal(client.status, 'DISABLED'); assert.equal(client.reconnectDelay, 5000); assert.equal(server.actions.length, 0);
});

test('presses during an existing connection attempt join it without parallel info probes or actions', async t => {
  const { server, client, buttons, clock, sink, config } = await setup(t, false);
  let release; server.beforeInfo = () => new Promise(resolve => { release = resolve; });
  client.configure(config); await until(() => release);
  const baseline = server.requests.length;
  for (const kind of ['mute', 'emergency']) { buttons.attach(kind, kind, { target: 'bus', busId }, sink); await buttons.press(kind); }
  assert.equal(server.requests.length, baseline); assert.equal(client.status, 'CONNECTING');
  release(); server.beforeInfo = undefined; await until(() => client.status === 'CONNECTED');
  assert.equal(server.actions.length, 0); assert.equal(clock.jobs.size, 0);
});

test('explicit stop cancels disabled polling without any new request', async t => {
  const { server, client, clock, config } = await setup(t, false);
  server.failure = { status: 503, code: 'DISABLED' }; client.configure(config); await until(() => client.status === 'DISABLED');
  const baseline = server.requests.length; client.stop(); clock.advance(60000);
  assert.equal(clock.jobs.size, 0); assert.equal(server.requests.length, baseline); assert.equal(server.actions.length, 0);
});
