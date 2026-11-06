import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { MockParaBus, until, busId } from './mock-parabus.mjs';

test('real SDK transport: four registered actions, global-only token, clean PI/settings/titles/logs', async t => {
  const server = await new MockParaBus().start();
  const sdk = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(sdk, 'listening');
  const root = 'io.github.adilazkahadiko.parabus', cwd = path.resolve(`${root}.sdPlugin`);
  let settings = { port: server.port, token: server.token }, socket, child, exited = false, output = '';
  const received = [];
  t.after(async () => {
    if (child && !exited) { child.kill(); await until(() => exited); }
    for (const ws of sdk.clients) ws.terminate(); await new Promise(resolve => sdk.close(resolve)); await server.close();
  });
  sdk.on('connection', ws => {
    socket = ws;
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'getGlobalSettings') ws.send(JSON.stringify({ event: 'didReceiveGlobalSettings', id: msg.id, payload: { settings } }));
      else if (msg.event === 'setGlobalSettings') settings = msg.payload;
      else received.push(msg);
    });
  });
  const info = { application: { version: '7.1.0', platform: 'windows', platformVersion: '10', language: 'en' }, plugin: { uuid: root, version: '0.1.0.0' },
    devices: [{ id: 'mock-mk2', name: 'Mock MK.2', type: 0, size: { columns: 5, rows: 3 } }], devicePixelRatio: 1, colors: {} };
  // Test-only preload injects a real unhandled rejection; production has no test hook.
  const preload = "process.on('message', value => { if (value === 'test-rejection') void Promise.reject(new Error('Synthetic test rejection')); });";
  child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'bin/plugin.js', '-port', String(sdk.address().port), '-pluginUUID', root, '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.on('exit', () => { exited = true; }); child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  await until(() => received.some(m => m.event === 'registerPlugin'), 'SDK registration');
  await until(() => server.wsServer.clients.size === 1, 'ParaBus WS');
  const send = (event, kind, payload) => socket.send(JSON.stringify({ event, action: `${root}.${kind}`, context: kind, device: 'mock-mk2', ...(payload ? { payload } : {}) }));
  for (const kind of ['mute', 'fader-up', 'fader-down', 'emergency']) {
    send('willAppear', kind, { controller: 'Keypad', coordinates: { column: 0, row: 0 }, isInMultiAction: false,
      settings: kind === 'emergency' ? { token: server.token } : { target: 'bus', busId, stepDb: 2, token: server.token, displayName: 'must not persist' } });
  }
  await until(() => received.filter(m => m.event === 'setSettings').length === 4, 'sanitize settings');
  send('propertyInspectorDidAppear', 'mute'); send('sendToPlugin', 'mute', { type: 'hello' });
  await until(() => received.some(m => m.event === 'sendToPropertyInspector' && m.payload.tokenConfigured));
  for (const kind of ['mute', 'fader-up', 'fader-down', 'emergency']) {
    const count = server.actions.length; send('keyDown', kind, { controller: 'Keypad', settings: {} }); await until(() => server.actions.length === count + 1);
    await until(() => received.some(m => m.event === 'setTitle' && m.context === kind));
  }
  assert.deepEqual(server.actions.map(a => a.operation), ['bus.mute.toggle', 'bus.fader.adjust', 'bus.fader.adjust', 'emergency.set']);
  child.send('test-rejection');
  await until(() => received.some(m => m.event === 'setTitle' && m.context === 'fader-up' && m.payload.title === 'STOPPED'), 'rejection stops connection');
  const beforeReconnect = received.length, requestsBeforeReconnect = server.requests.length;
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(server.requests.length, requestsBeforeReconnect);
  send('keyDown', 'fader-up', { controller: 'Keypad', settings: {} });
  await until(() => received.slice(beforeReconnect).some(m => m.event === 'setTitle' && m.context === 'fader-up' && m.payload.title === 'CONNECT'), 'press reconnects after rejection');
  await until(() => received.slice(beforeReconnect).some(m => m.event === 'sendToPropertyInspector' && m.payload.status === 'CONNECTED'), 'recovered from rejection');
  assert.equal(server.actions.length, 4, 'reconnecting press is never replayed');
  send('keyDown', 'fader-up', { controller: 'Keypad', settings: {} }); await until(() => server.actions.length === 5);
  send('sendToPlugin', 'mute', { type: 'connection.save', port: server.port, token: server.token });
  await until(() => received.filter(m => m.event === 'sendToPropertyInspector').length >= 3);
  // Exercise SDK error logging too: raw inbound payloads must never reach a log.
  socket.send(`{broken:${server.token}`);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(!JSON.stringify(received).includes(server.token), 'secret must not appear in settings, PI or titles');
  assert.ok(settings.token === server.token, 'secret belongs only in global storage');
  assert.ok(!output.includes(server.token), 'secret must not appear in stdout/stderr');
  const logs = await readdir(path.join(cwd, 'logs')).catch(() => []);
  for (const name of logs) {
    const data = await readFile(path.join(cwd, 'logs', name), 'utf8');
    assert.ok(!data.includes(server.token), 'secret must not appear in SDK log files');
  }
  assert.ok(!exited, 'plugin remains running');
});
