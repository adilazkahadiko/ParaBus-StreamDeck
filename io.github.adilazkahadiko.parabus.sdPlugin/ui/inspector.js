/* Browser UI talks only to Stream Deck's registration socket, never to ParaBus. */
'use strict';
let socket, context, action, kind, connectionSignature, choices = { buses: [], profiles: [], users: [], selectors: [], hasState: false };
const selectorAction = () => kind === 'selector' || kind === 'selector-off';
const element = id => document.getElementById(id);
function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'sendToPlugin', action, context, payload }));
}
function missingLabel(value) { return `${value}（${choices.hasState ? '見つかりません' : '未接続'}）`; }
function fill(id, options, emptyLabel) {
  const select = element(id), value = select.value;
  select.replaceChildren();
  if (emptyLabel) select.add(new Option(emptyLabel, ''));
  for (const item of options) select.add(new Option(item.label ?? item.id, item.id));
  if (value && !options.some(o => o.id === value)) select.add(new Option(missingLabel(value), value));
  select.value = value;
}
function fillUsers() {
  const select = element('userSelect'), value = select.value;
  select.replaceChildren(new Option('Select participant / 参加者を選択', ''));
  for (const user of choices.users) select.add(new Option(user.label, user.id));
  if (value && value !== 'manual' && !choices.users.some(u => u.id === value)) select.add(new Option(missingLabel(value), value));
  select.add(new Option('ID を直接入力 / Enter ID', 'manual'));
  select.value = value;
  element('manualUserField').hidden = value !== 'manual';
}
function updateFields() {
  element('selectorFields').hidden = !selectorAction(); element('legacyFields').hidden = selectorAction();
  element('teamField').hidden = kind === 'selector-off';
  fill('selectorId', choices.selectors, 'セレクターを選択');
  fill('teamBusId', choices.selectors.find(s => s.id === element('selectorId').value)?.teams ?? [], 'チームを選択');
  const target = element('target').value, participant = element('participant').value;
  element('participantFields').hidden = target !== 'send';
  element('userField').hidden = participant === 'slot';
  element('slotFields').hidden = participant !== 'slot';
  element('busField').hidden = target !== 'bus' && target !== 'send';
  element('profileField').hidden = target !== 'tx';
  fillUsers();
  fill('busId', choices.buses.filter(b => target !== 'send' || b.kind === 'vc'));
  fill('scopeBusId', choices.buses.filter(b => b.kind === 'vc'), 'All / 全員');
  fill('profileId', choices.profiles.map(id => ({ id })));
}
function applySettings(s) {
  for (const id of ['target', 'participant', 'discordUserId', 'index', 'stepDb', 'label']) {
    element(id).value = s[id] ?? ({ target: '', participant: 'user', discordUserId: '', index: 1, stepDb: 1, label: '' })[id];
  }
  element('userSelect').value = s.discordUserId ?? '';
  // Insert saved IDs before selecting: native <select> ignores values absent from its options.
  if (s.discordUserId && ![...element('userSelect').options].some(o => o.value === s.discordUserId)) {
    element('userSelect').add(new Option(missingLabel(s.discordUserId), s.discordUserId));
    element('userSelect').value = s.discordUserId;
  }
  updateFields();
  for (const id of ['busId', 'scopeBusId', 'profileId']) {
    const value = s[id] ?? '';
    if (value && ![...element(id).options].some(o => o.value === value)) element(id).add(new Option(missingLabel(value), value));
    element(id).value = value;
  }
  if (selectorAction()) {
    const id = s.selectorId ?? '';
    if (id && ![...element('selectorId').options].some(o => o.value === id)) element('selectorId').add(new Option(missingLabel(id), id));
    element('selectorId').value = id; updateFields();
    const busId = s.busId ?? '';
    if (busId && ![...element('teamBusId').options].some(o => o.value === busId)) element('teamBusId').add(new Option(missingLabel(busId), busId));
    element('teamBusId').value = busId;
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
    if (p.type === 'connection-preview') { element('connectionDetails').textContent = `IPv4: ${p.address}  Port: ${p.port}\nSHA-256: ${p.fingerprint}`; return; }
    if (p.type === 'save-error') { element('status').textContent = p.status === 'INVALID' ? '接続コード・IPv4の形式を確認してください' : '保存失敗。WindowsのDPAPIを確認し、鍵を入力し直してください。'; return; }
    if (p.type !== 'status') return;
    element('status').textContent = p.status === 'CERTIFICATE' ? '接続先が本物のParaBusか確認できません' : p.status === 'TIER_FORBIDDEN' ? '権限なし' : String(p.status);
    element('configured').textContent = p.tokenConfigured ? 'Token: configured / 設定済み' : 'Token: not configured / 未設定';
    if (document.activeElement !== element('port')) element('port').value = p.port;
    const signature = JSON.stringify([p.mode, p.address, p.port, p.fingerprint]);
    if (connectionSignature !== signature) {
      connectionSignature = signature; element('connectionMode').value = p.mode === 'lan' ? 'lan' : 'local';
      element('addressOverride').value = p.address ?? '';
      element('connectionDetails').textContent = p.mode === 'lan' ? `IPv4: ${p.address}  Port: ${p.port}\nSHA-256: ${p.fingerprint}` : '';
      connectionFields();
    }
    element('storageWarning').textContent = p.storageWarning ?? '';
    choices = { buses: p.buses, profiles: p.profiles, users: p.users, selectors: p.selectors ?? [], hasState: p.hasState === true };
    if (p.settings) applySettings(p.settings); else updateFields();
  };
  socket.onclose = () => {
    element('token').value = ''; element('connectionCode').value = ''; element('status').textContent = 'Plugin disconnected / 切断';
    choices = { buses: [], profiles: [], users: [], selectors: [], hasState: false }; updateFields();
  };
};
element('target').addEventListener('change', updateFields);
element('participant').addEventListener('change', updateFields);
element('selectorId').addEventListener('change', () => { element('teamBusId').value = ''; updateFields(); });
function connectionFields() { const lan = element('connectionMode').value === 'lan'; element('localConnection').hidden = lan; element('lanConnection').hidden = !lan; }
element('connectionMode').addEventListener('change', connectionFields);
element('connectionCode').addEventListener('input', () => {
  element('addressOverride').value = '';
  const code = element('connectionCode').value.trim();
  element('connectionDetails').textContent = code ? '接続コードを検証中…' : '';
  if (code) send({ type: 'connection.preview', code });
});
element('userSelect').addEventListener('change', () => { element('manualUserField').hidden = element('userSelect').value !== 'manual'; });
element('saveConnection').addEventListener('click', () => {
  if (element('connectionMode').value === 'lan') {
    const code = element('connectionCode').value.trim(); element('connectionCode').value = '';
    send({ type: 'connection.save', mode: 'lan', code, address: element('addressOverride').value.trim() }); return;
  }
  const port = Number(element('port').value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { element('status').textContent = 'Invalid port / ポート不正'; return; }
  const token = element('token').value; element('token').value = '';
  send({ type: 'connection.save', port, ...(token ? { token } : {}) });
});
element('connect').addEventListener('click', () => send({ type: 'connection.connect' }));
element('clear').addEventListener('click', () => { element('token').value = ''; element('connectionCode').value = ''; send({ type: 'connection.clear' }); });
element('saveButton').addEventListener('click', () => {
  if (selectorAction()) {
    const selectorId = element('selectorId').value, busId = element('teamBusId').value;
    if (!selectorId || kind === 'selector' && !busId) { element('status').textContent = 'セレクター・チームを選択してください'; return; }
    send({ type: 'button.save', settings: { selectorId, ...(kind === 'selector' ? { busId } : {}) } }); return;
  }
  const target = element('target').value, settings = { target };
  const label = element('label').value.trim();
  if (label) settings.label = label;
  if (!['bus', 'send', 'tx'].includes(target)) { element('status').textContent = 'Select target / 対象を選択'; return; }
  if (target === 'send') {
    settings.participant = element('participant').value;
    if (settings.participant === 'slot') { settings.index = Number(element('index').value); if (element('scopeBusId').value) settings.scopeBusId = element('scopeBusId').value; }
    else {
      settings.discordUserId = element('userSelect').value === 'manual' ? element('discordUserId').value.trim() : element('userSelect').value;
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
updateFields();
