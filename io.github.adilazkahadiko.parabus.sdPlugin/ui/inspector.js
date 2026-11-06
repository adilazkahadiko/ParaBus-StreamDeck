/* Browser UI talks only to Stream Deck's registration socket, never to ParaBus. */
'use strict';
let socket, context, action, kind, choices = { buses: [], profiles: [], users: [] };
const element = id => document.getElementById(id);
function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'sendToPlugin', action, context, payload }));
}
function fill(id, options, emptyLabel) {
  const select = element(id), value = select.value;
  select.replaceChildren();
  if (emptyLabel) select.add(new Option(emptyLabel, ''));
  for (const item of options) select.add(new Option(item.label ?? item.id, item.id));
  if (value && !options.some(o => o.id === value)) select.add(new Option(`${value} (unavailable / 未接続)`, value));
  select.value = value;
}
function updateFields() {
  const target = element('target').value, participant = element('participant').value;
  element('participantFields').hidden = target !== 'channel' && target !== 'send';
  element('userField').hidden = participant === 'slot';
  element('slotFields').hidden = participant !== 'slot';
  element('busField').hidden = target !== 'bus' && target !== 'send';
  element('profileField').hidden = target !== 'tx';
  fill('busId', choices.buses.filter(b => target !== 'send' || b.kind === 'vc'));
  fill('scopeBusId', choices.buses.filter(b => b.kind === 'vc'), 'All / 全員');
  fill('profileId', choices.profiles.map(id => ({ id })));
}
function applySettings(s) {
  for (const id of ['target', 'participant', 'discordUserId', 'index', 'stepDb']) {
    element(id).value = s[id] ?? ({ target: 'channel', participant: 'user', discordUserId: '', index: 1, stepDb: 1 })[id];
  }
  updateFields();
  for (const id of ['busId', 'scopeBusId', 'profileId']) {
    const value = s[id] ?? '';
    if (value && ![...element(id).options].some(o => o.value === value)) element(id).add(new Option(value, value));
    element(id).value = value;
  }
}
window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
  const info = JSON.parse(actionInfo); context = uuid; action = info.action; kind = action.split('.').at(-1);
  element('buttonSettings').hidden = kind === 'emergency'; element('emergencyHelp').hidden = kind !== 'emergency';
  element('stepField').hidden = kind === 'mute';
  if (kind === 'mute') element('target').querySelector('option[value="tx"]').remove();
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => { socket.send(JSON.stringify({ event: registerEvent, uuid })); send({ type: 'hello' }); };
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.event !== 'sendToPropertyInspector') return;
    const p = msg.payload;
    if (p.type === 'save-error') { element('status').textContent = 'Unable to save / 保存失敗'; return; }
    if (p.type !== 'status') return;
    element('status').textContent = String(p.status);
    element('configured').textContent = p.tokenConfigured ? 'Token: configured / 設定済み' : 'Token: not configured / 未設定';
    if (document.activeElement !== element('port')) element('port').value = p.port;
    choices = { buses: p.buses, profiles: p.profiles, users: p.users };
    element('users').replaceChildren(...p.users.map(u => { const o = document.createElement('option'); o.value = u.id; o.textContent = u.label; return o; }));
    if (p.settings) applySettings(p.settings); else updateFields();
  };
  socket.onclose = () => { element('token').value = ''; element('status').textContent = 'Plugin disconnected / 切断'; };
};
element('target').addEventListener('change', updateFields);
element('participant').addEventListener('change', updateFields);
element('saveConnection').addEventListener('click', () => {
  const port = Number(element('port').value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { element('status').textContent = 'Invalid port / ポート不正'; return; }
  const token = element('token').value; element('token').value = '';
  send({ type: 'connection.save', port, ...(token ? { token } : {}) });
});
element('connect').addEventListener('click', () => send({ type: 'connection.connect' }));
element('clear').addEventListener('click', () => { element('token').value = ''; send({ type: 'connection.clear' }); });
element('saveButton').addEventListener('click', () => {
  const target = element('target').value, settings = { target };
  if (target === 'channel' || target === 'send') {
    settings.participant = element('participant').value;
    if (settings.participant === 'slot') { settings.index = Number(element('index').value); if (element('scopeBusId').value) settings.scopeBusId = element('scopeBusId').value; }
    else {
      settings.discordUserId = element('discordUserId').value.trim();
      if (!/^\d{17,20}$/.test(settings.discordUserId)) { element('status').textContent = 'Invalid Discord ID / ID不正'; return; }
    }
  }
  if (target === 'bus' || target === 'send') settings.busId = element('busId').value;
  if (target === 'tx') settings.profileId = element('profileId').value;
  if (kind !== 'mute') {
    settings.stepDb = Number(element('stepDb').value);
    if (!Number.isFinite(settings.stepDb) || settings.stepDb <= 0 || settings.stepDb > 6) { element('status').textContent = 'Step must be 0–6 dB (exclusive of 0) / 0超〜6 dB'; return; }
  }
  if (settings.participant === 'slot' && (!Number.isInteger(settings.index) || settings.index < 1 || settings.index > 112)) {
    element('status').textContent = 'Invalid slot / slot不正'; return;
  }
  send({ type: 'button.save', settings });
});
