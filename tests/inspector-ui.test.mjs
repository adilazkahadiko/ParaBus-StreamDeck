import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const script = await readFile('io.github.adilazkahadiko.parabus.sdPlugin/ui/inspector.js', 'utf8');
const html = await readFile('io.github.adilazkahadiko.parabus.sdPlugin/ui/inspector.html', 'utf8');
function ui(kind = 'fader-up') {
  const elements = new Map(), connections = [];
  const element = id => {
    if (!elements.has(id)) {
      const item = {
      value: ({ target: '', participant: 'user', index: '1', stepDb: '1', port: '4175' })[id] ?? '',
      hidden: false, options: [], textContent: '', events: {},
      add(o) { this.options.push(o); }, replaceChildren(...items) { this.options = items; if (id === 'userSelect') this.value = items[0]?.value ?? ''; },
      addEventListener(event, fn) { this.events[event] = fn; },
      querySelector() { return { remove() {} }; }
      };
      if (id === 'userSelect') {
        let value = '';
        Object.defineProperty(item, 'value', { get: () => value, set: next => { value = item.options.some(o => o.value === next) ? next : ''; } });
      }
      elements.set(id, item);
    }
    return elements.get(id);
  };
  class Socket {
    static OPEN = 1;
    readyState = 1; messages = [];
    constructor(url) { this.url = url; connections.push(this); }
    send(msg) { this.messages.push(JSON.parse(msg)); }
  }
  const context = vm.createContext({ document: { getElementById: element, createElement: () => ({}) }, window: {},
    WebSocket: Socket, Option: function (label, value) { this.label = label; this.value = value; } });
  vm.runInContext(script, context);
  context.window.connectElgatoStreamDeckSocket('45678', 'context', 'registerPropertyInspector', '{}', JSON.stringify({ action: `io.github.adilazkahadiko.parabus.${kind}` }));
  connections[0].onopen();
  return { element, socket: connections[0], connections };
}
test('PI browser: only Stream Deck socket, write-only password, global token message separated from button settings', () => {
  const { element, socket, connections } = ui(); const secret = randomBytes(32).toString('base64url');
  element('token').value = secret; element('saveConnection').events.click();
  assert.equal(element('token').value, '');
  assert.ok(socket.messages.some(m => m.payload?.type === 'connection.save' && m.payload.token === secret));
  element('target').value = 'send'; element('busId').value = 'external-bus:test';
  element('userSelect').value = 'manual'; element('userSelect').events.change();
  element('discordUserId').value = '100000000000000001'; element('stepDb').value = '3'; element('saveButton').events.click();
  const settings = socket.messages.find(m => m.payload?.type === 'button.save').payload.settings;
  assert.ok(!JSON.stringify(settings).includes(secret)); assert.equal(settings.stepDb, 3);
  assert.ok(!socket.messages.some(m => m.event === 'getGlobalSettings' || m.event === 'setSettings' || m.event === 'setGlobalSettings'));
  assert.deepEqual(connections.map(c => c.url), ['ws://127.0.0.1:45678']);
  socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: { type: 'status', port: 4175, status: 'CONNECTED', tokenConfigured: true,
    users: [{ id: '100000000000000001', label: '<script>test</script>' }], buses: [], profiles: [] } }) });
  assert.equal(element('token').value, ''); assert.equal(element('userSelect').options[1].label, '<script>test</script>');
});
test('PI browser validates button values and clears password on disconnect', () => {
  const { element, socket } = ui();
  element('target').value = 'send';
  element('userSelect').value = 'manual'; element('userSelect').events.change();
  element('discordUserId').value = 'not-an-id'; element('saveButton').events.click();
  assert.ok(!socket.messages.some(m => m.payload?.type === 'button.save'));
  element('discordUserId').value = '100000000000000001'; element('stepDb').value = '7'; element('saveButton').events.click();
  assert.ok(!socket.messages.some(m => m.payload?.type === 'button.save'));
  element('token').value = 'synthetic-test-input'; socket.onclose(); assert.equal(element('token').value, '');
});
test('PI targets exclude channel and explain participant MIX send controls', () => {
  const targetSelect = html.match(/<select id="target">(.*?)<\/select>/s)[1];
  assert.deepEqual([...targetSelect.matchAll(/value="([^"]*)"/g)].map(m => m[1]), ['', 'bus', 'send', 'tx']);
  assert.match(targetSelect, /value="send">Participant MIX \(Send\) \/ 参加者の MIX（Send）/);
  assert.match(html, /参加者 → VC MIX の On\/Off とレベル/);
  const { element, socket } = ui();
  for (const target of ['', 'channel']) {
    element('target').value = target; element('target').events.change();
    assert.equal(element('participantFields').hidden, true);
    element('saveButton').events.click();
    assert.ok(!socket.messages.some(m => m.payload?.type === 'button.save'));
  }
});
test('PI sanitized legacy settings stay unselected until a new target is chosen', () => {
  const { element, socket } = ui();
  socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: {
    type: 'status', status: 'CONNECTED', port: 4175, tokenConfigured: true,
    settings: { stepDb: 2 }, users: [], buses: [{ id: 'vc-bus', kind: 'vc' }, { id: 'other-bus', kind: 'other' }], profiles: []
  } }) });
  assert.equal(element('target').value, '');
  element('saveButton').events.click();
  assert.ok(!socket.messages.some(m => m.payload?.type === 'button.save'));
  element('target').value = 'send'; element('target').events.change();
  assert.equal(element('participantFields').hidden, false);
  assert.deepEqual(element('busId').options.map(o => o.value), ['vc-bus']);
  element('userSelect').value = 'manual'; element('userSelect').events.change();
  element('discordUserId').value = '100000000000000001'; element('busId').value = 'vc-bus';
  element('saveButton').events.click();
  assert.deepEqual(socket.messages.find(m => m.payload?.type === 'button.save').payload.settings,
    { target: 'send', participant: 'user', discordUserId: '100000000000000001', busId: 'vc-bus', stepDb: 2 });
});

test('PI participant select shows names/IDs and preserves a saved missing ID with its numeric value', () => {
  const { element, socket } = ui();
  const send = payload => socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: {
    type: 'status', status: 'CONNECTED', hasState: true, port: 4175, tokenConfigured: true, buses: [], profiles: [], ...payload
  } }) });
  const saved = '100000000000000009';
  send({ users: [{ id: '100000000000000001', label: 'Synthetic Guest ●' }, { id: '100000000000000002', label: '100000000000000002' }],
    settings: { target: 'send', participant: 'user', discordUserId: saved } });
  assert.equal(element('userSelect').value, saved);
  assert.equal(element('manualUserField').hidden, true);
  assert.deepEqual(element('userSelect').options.map(o => [o.value, o.label]), [
    ['', 'Select participant / 参加者を選択'],
    ['100000000000000001', 'Synthetic Guest ●'], ['100000000000000002', '100000000000000002'],
    [saved, `${saved}（見つかりません）`], ['manual', 'ID を直接入力 / Enter ID']
  ]);
  element('saveButton').events.click();
  assert.equal(socket.messages.at(-1).payload.settings.discordUserId, saved);
  element('userSelect').value = '100000000000000001'; element('userSelect').events.change();
  element('saveButton').events.click();
  assert.deepEqual(socket.messages.at(-1).payload.settings, { target: 'send', participant: 'user', discordUserId: '100000000000000001', busId: '', stepDb: 1 });
  send({ users: [] });
  assert.equal(element('userSelect').value, '100000000000000001');
  assert.ok(element('userSelect').options.some(o => o.label === '100000000000000001（見つかりません）'));
  assert.ok(!element('userSelect').options.some(o => o.label.includes('Synthetic Guest')));
});

test('PI manual ID mode and named Bus/scope selectors save only the existing settings keys', () => {
  const { element, socket } = ui();
  socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: {
    type: 'status', status: 'CONNECTED', port: 4175, tokenConfigured: true,
    users: [], buses: [{ id: 'vc-bus', kind: 'vc', label: 'Synthetic VC' }, { id: 'other-bus', kind: 'other', label: 'Bus 2' }], profiles: [],
    settings: { target: 'send', participant: 'user', busId: 'vc-bus', stepDb: 2 }
  } }) });
  assert.equal(element('busId').options[0].label, 'Synthetic VC');
  assert.equal(element('scopeBusId').options.find(o => o.value === 'vc-bus').label, 'Synthetic VC');
  element('userSelect').value = 'manual'; element('userSelect').events.change();
  assert.equal(element('manualUserField').hidden, false);
  element('discordUserId').value = '100000000000000003'; element('saveButton').events.click();
  assert.deepEqual(socket.messages.at(-1).payload.settings, {
    target: 'send', participant: 'user', discordUserId: '100000000000000003', busId: 'vc-bus', stepDb: 2
  });
  element('participant').value = 'slot'; element('participant').events.change();
  element('scopeBusId').value = 'vc-bus'; element('saveButton').events.click();
  assert.deepEqual(socket.messages.at(-1).payload.settings, { target: 'send', participant: 'slot', index: 1, scopeBusId: 'vc-bus', busId: 'vc-bus', stepDb: 2 });
  assert.ok(!JSON.stringify(socket.messages).includes('Synthetic VC'));
});

test('PI saved participant/Bus/scope IDs distinguish no state from connected missing choices without changing values', () => {
  const { element, socket } = ui(), user = '100000000000000009', bus = 'synthetic-missing-bus';
  const status = (hasState, settings) => socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: {
    type: 'status', status: hasState ? 'CONNECTED' : 'CONNECTING', hasState, port: 4175, tokenConfigured: true,
    users: [], buses: [], profiles: [], ...(settings ? { settings } : {})
  } }) });
  const settings = { target: 'send', participant: 'user', discordUserId: user, busId: bus, scopeBusId: bus, stepDb: 2 };
  const check = message => {
    for (const [id, value] of [['userSelect', user], ['busId', bus], ['scopeBusId', bus]]) {
      assert.equal(element(id).value, value);
      assert.equal(element(id).options.find(o => o.value === value).label, `${value}（${message}）`);
    }
  };
  status(false, settings); check('未接続');
  status(true); check('見つかりません');
  status(true, settings); check('見つかりません');
  status(false); check('未接続');
  element('saveButton').events.click();
  assert.deepEqual(socket.messages.at(-1).payload.settings, { target: 'send', participant: 'user', discordUserId: user, busId: bus, stepDb: 2 });
  status(true); check('見つかりません'); socket.onclose(); check('未接続');
});
