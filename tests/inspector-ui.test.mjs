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
    if (!elements.has(id)) elements.set(id, {
      value: ({ target: '', participant: 'user', index: '1', stepDb: '1', port: '4175' })[id] ?? '',
      hidden: false, options: [], textContent: '', events: {},
      add(o) { this.options.push(o); }, replaceChildren(...items) { this.options = items; },
      addEventListener(event, fn) { this.events[event] = fn; },
      querySelector() { return { remove() {} }; }
    });
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
  element('discordUserId').value = '100000000000000001'; element('stepDb').value = '3'; element('saveButton').events.click();
  const settings = socket.messages.find(m => m.payload?.type === 'button.save').payload.settings;
  assert.ok(!JSON.stringify(settings).includes(secret)); assert.equal(settings.stepDb, 3);
  assert.ok(!socket.messages.some(m => m.event === 'getGlobalSettings' || m.event === 'setSettings' || m.event === 'setGlobalSettings'));
  assert.deepEqual(connections.map(c => c.url), ['ws://127.0.0.1:45678']);
  socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: { type: 'status', port: 4175, status: 'CONNECTED', tokenConfigured: true,
    users: [{ id: '100000000000000001', label: '<script>test</script>' }], buses: [], profiles: [] } }) });
  assert.equal(element('token').value, ''); assert.equal(element('users').options[0].textContent, '<script>test</script>');
});
test('PI browser validates button values and clears password on disconnect', () => {
  const { element, socket } = ui();
  element('target').value = 'send';
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
  element('discordUserId').value = '100000000000000001'; element('busId').value = 'vc-bus';
  element('saveButton').events.click();
  assert.deepEqual(socket.messages.find(m => m.payload?.type === 'button.save').payload.settings,
    { target: 'send', participant: 'user', discordUserId: '100000000000000001', busId: 'vc-bus', stepDb: 2 });
});
