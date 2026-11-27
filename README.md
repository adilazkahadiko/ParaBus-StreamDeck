# ParaBus for Stream Deck

GPL-3.0-only. Version 0.2.0 for Stream Deck MK.2 buttons on Windows 10+ and Stream Deck 7.1+. Uses the official Node.js SDK, with manifest Node.js **24**. See [日本語](README.ja.md) and [CHANGELOG](CHANGELOG.md).

0.2.0 adds authenticated LAN connections and Output Selector / Selector OFF buttons. These features require a ParaBus build containing PRs #40 and #41. Older ParaBus versions continue to support the existing local buttons.

Choose **接続コード / 別のPC** and paste the host's `parabus1:` code. The inspector validates it and shows only IPv4, port and SHA-256 fingerprint. Save the connection. The code contains a device key: do not show it to others or paste it into chat. **IPアドレスを変更** changes only the destination IPv4; the certificate pin remains mandatory. A different or expired certificate stops the connection before any key is sent, for both HTTPS and WSS. The inspector shows “接続先が本物のParaBusか確認できません”. Reconnect explicitly after correcting the code/address; there is no downgrade to HTTP.

For each selector button, choose the selector and team from the granted lists. SWITCH selectors switch on short release; holding for at least 0.5 seconds and releasing adds an unselected team or removes a selected team. ADDITIVE selectors toggle on release. Active teams light up; added SWITCH teams show `＋`. Without display-name permission they use `Team 1`, `Team 2`, etc. Removing the final team displays `OFFを使用`; use the separate Selector OFF button. Disconnected presses are consumed, never queued. Operations denied by the host show `権限なし`, including existing mute/fader/emergency buttons over LAN. This plugin still sends only Tier A operations.

The original local connection remains **このPC / 127.0.0.1**, port 4175 by default, with a device token. Existing action IDs and local settings remain compatible.

Requires **ParaBus v0.1.0-beta.6 or later**. ParaBus beta.5 and earlier do not provide the external control API. Get ParaBus from the [beta.6 download page](https://github.com/adilazkahadiko/ParaBus/releases/tag/v0.1.0-beta.6).

With Node.js 24 installed, run:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run validate
npm.cmd run pack
```

Double-click `dist/io.github.adilazkahadiko.parabus.streamDeckPlugin` to install. Add Toggle Mute, Fader Up/Down, or Emergency Mute ON to a key.

The plugin displays the target name and state in button titles (title edits in Stream Deck are overwritten). Names are limited to 8 half-width cells (full-width characters and the truncation mark `…` count as 2), with a default font size of 9 for mute/fader keys; emergency and error text are unchanged.

Version 0.1.3 preserves trailing numbers and parenthesized numbers: `VC Bus 9` stays unchanged, `VC Bus 10` becomes `VC Bus10`, and `Long Mix 10` becomes `Long…10`. When necessary, whitespace before the number is removed first; longer names use a prefix, `…`, and the number. Names without a numeric suffix keep the usual end truncation. If the suffix alone exceeds the limit, width 8 takes priority and its last digits are retained.

Use **ボタンの表示名（任意） / Button label (optional)** near Target to enter your own name, then save the button. Leave it blank for the automatic user/Bus name (or TX number). Only this manually entered `label` is saved in action settings; control characters and surrounding whitespace are removed and it is limited to 32 Unicode characters. The same width-8 display rule applies. Clearing it restores automatic names; older settings without `label` continue to work. Stream Deck's title field is still overwritten; font size can be changed in Stream Deck. If an older button retains oversized text, re-add it or adjust its font size.

In ParaBus **SETUP → 接続する機器**, register a device and copy its once-displayed token into the plugin's password field. Enable external control explicitly, including after each ParaBus restart. Stage B permissions are unnecessary; display names are optional. Save the connection, then select the target and save each button. The host is fixed at `127.0.0.1`; the default port is `4175`.

Tokens are stored **only in plugin global settings**, never action settings. On Windows, 0.2.0 encrypts the token with **CurrentUser DPAPI** before calling the SDK's settings writer (`protectedToken: dpapi:v1:…`). The connection code is discarded after parsing; address, port and pin are non-secret metadata. Legacy plaintext global tokens are migrated when read. If migration fails, the old configuration remains usable with a warning; new saves fail without writing plaintext. An unreadable encrypted key requires re-entry on the current Windows account. The inspector never receives saved token values. Removing the token clears its saved ciphertext; revoke the host device separately.

Storage investigation **U4**: on this Windows installation the Stream Deck-managed global value is `HKCU\Software\Elgato Systems GmbH\StreamDeck`, value name `io.github.adilazkahadiko.parabusio.github.adilazkahadiko.parabus` (REG_SZ). Only its location/type were inspected; no live credential contents were displayed or modified. This is an observed app implementation detail, not a stable SDK filename contract. The plugin does not write the registry directly or add a credential file under `%APPDATA%\Elgato\StreamDeck`. [Elgato's settings guide](https://docs.elgato.com/streamdeck/sdk/guides/settings/) specifies global settings for user access tokens and warns that action settings are plaintext and exported. The extra DPAPI layer does not depend on Stream Deck's internal encoding. It protects at rest for the current Windows user; backups and an already-compromised user account still require care. No new npm dependency is used. See [verification](docs/VERIFICATION.md).

The pack contains `SOURCE.txt` with corresponding source [v0.2.0](https://github.com/adilazkahadiko/ParaBus-StreamDeck/tree/v0.2.0) and its archive URL (audit L5). This PR prepares those version URLs; it does not create the tag or publish a Release. The tag must accompany eventual distribution.

[Profile-export inspection](README.ja.md#プロファイル書き出しの手動確認) completed on **2026-11-16**: a profile exported from the actual Stream Deck app was inspected; no token was present. ParaBus button settings contained only `target`, `participant`, `discordUserId`, `busId`, and `stepDb`. The only token-shaped strings were `external-bus:` aliases in `busId`.

Targets are **Bus**, **Participant MIX (Send) / 参加者の MIX（Send）**, and **TX** (fader only). Participant MIX (Send) controls the on/off state and level from a participant to a selected VC MIX. Select the participant by a 17–20 digit Discord user ID or a 1-based slot in the current all-participant or VC Bus order, and select the destination VC Bus. The current slot order and `participantsRevision` come from state and are never saved in button settings.

Version 0.1.1 uses a participant dropdown from `registeredUsers`: permitted names appear with a ● for online users; otherwise the user ID is shown. Missing saved IDs remain selectable. Choose **ID を直接入力 / Enter ID** for an unlisted user. Bus and slot-scope dropdowns use permitted Bus labels when provided by ParaBus; otherwise they show kind/order labels such as `VC Bus 1` or `Bus 2`. ParaBus beta.6 provides no Bus labels; beta.7 adds them under the same `readDisplayNames` permission. API-provided names are display-only and are never saved in action or global settings. IDs and existing settings keys are unchanged; v0.1.3 adds only the optional user-entered `label` key.
Duplicate participant names (ignoring surrounding whitespace and case) show `Name (…1234)` before the online mark, or the full ID if those last four digits collide; duplicate Bus labels receive `(2)`, `(3)`, etc., for display only.

Mute supports Bus and Participant MIX (Send), using current state and `expectedMute`; a stale reply corrects the display without retrying. Each fader press sends one relative adjustment (default 1 dB, configurable up to 6 dB). Emergency only enables mute; release it in ParaBus. No action is retried or queued automatically.

The former **Participant** target (`target: channel`) has been removed with the API's `channel.fader.*` and `channel.mute.*` operations. Saved buttons with this target show `SETUP` and send no operations. Choose a supported target and save the button again. Participant state no longer needs `faderDb` or `mute`; those legacy fields are ignored. Send controls use `participants[].sends[].db` and `mute`.

While external control is disabled (including WS close 4003), the plugin keeps showing `DISABLED` and checks `GET /info` every **5 seconds**, without exponential backoff or sending actions. After ParaBus is enabled, it completes the normal connection automatically. An offline key press shows `CONNECT` and attempts a connection immediately; that press is consumed and never runs an action after connecting. Press again once connected to operate. This also recovers a connection stopped by an unhandled rejection. Missing configuration and HTTP authentication failure (401) do not retry automatically or on key presses: enter a valid token in the inspector first.

On WS close **4001**, one authenticated HTTP `/state` check distinguishes beta.6 permission changes from invalid tokens: 200 reconnects immediately, 401 stops as `UNAUTHORIZED`. To bound loops, a new 4001 within **2 seconds** of that reconnection, or a **sixth check in a rolling 60-second window**, stops without another probe. Checks expire from the window after 60 seconds; explicit connection configuration resets the history. Presses during a check are consumed without sending or queuing actions. New close **4005** means permissions changed and reconnects immediately with fresh info/state. Neither path replays actions.

Saved participant and Bus IDs show `（未接続）` when no state is available; `（見つかりません）` is used only when a state is available and the ID is absent from the choices. Stored IDs are unchanged.

Tests use mock HTTP/WS and Stream Deck servers, without starting ParaBus, connecting bots, or using audio hardware. [Verification and remaining checks](docs/VERIFICATION.md), [all dependency versions/licenses](docs/DEPENDENCIES.md). npm audit currently flags an upstream SDK dependency; see the verification report.
