# ParaBus for Stream Deck

GPL-3.0-only. First Stage 3 release for Stream Deck MK.2 buttons on Windows 10+ and Stream Deck 7.1+. Uses the official Node.js SDK, with manifest Node.js **24**. See [日本語](README.ja.md).

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

In ParaBus **SETUP → 接続する機器**, register a device and copy its once-displayed token into the plugin's password field. Enable external control explicitly, including after each ParaBus restart. Stage B permissions are unnecessary; display names are optional. Save the connection, then select the target and save each button. The host is fixed at `127.0.0.1`; the default port is `4175`.

Tokens are stored **only in plugin global settings**, never action settings. The inspector sends new input to the plugin and only receives a configured/not-configured flag. Global settings are managed by Stream Deck; this does not promise encryption. Protect local app data, revoke tokens when needed, and keep tokens out of source control.

[Profile-export inspection](README.ja.md#プロファイル書き出しの手動確認) completed on **2026-11-16**: a profile exported from the actual Stream Deck app was inspected; no token was present. ParaBus button settings contained only `target`, `participant`, `discordUserId`, `busId`, and `stepDb`. The only token-shaped strings were `external-bus:` aliases in `busId`.

Targets are **Bus**, **Participant MIX (Send) / 参加者の MIX（Send）**, and **TX** (fader only). Participant MIX (Send) controls the on/off state and level from a participant to a selected VC MIX. Select the participant by a 17–20 digit Discord user ID or a 1-based slot in the current all-participant or VC Bus order, and select the destination VC Bus. The current slot order and `participantsRevision` come from state and are never saved in button settings.

Mute supports Bus and Participant MIX (Send), using current state and `expectedMute`; a stale reply corrects the display without retrying. Each fader press sends one relative adjustment (default 1 dB, configurable up to 6 dB). Emergency only enables mute; release it in ParaBus. No action is retried or queued automatically.

The former **Participant** target (`target: channel`) has been removed with the API's `channel.fader.*` and `channel.mute.*` operations. Saved buttons with this target show `SETUP` and send no operations. Choose a supported target and save the button again. Participant state no longer needs `faderDb` or `mute`; those legacy fields are ignored. Send controls use `participants[].sends[].db` and `mute`.

While external control is disabled (including WS close 4003), the plugin keeps showing `DISABLED` and checks `GET /info` every **5 seconds**, without exponential backoff or sending actions. After ParaBus is enabled, it completes the normal connection automatically. An offline key press shows `CONNECT` and attempts a connection immediately; that press is consumed and never runs an action after connecting. Press again once connected to operate. This also recovers a connection stopped by an unhandled rejection. Missing configuration and authentication failure (401 / WS close 4001) do not retry automatically or on key presses: enter a valid token in the inspector first.

Tests use mock HTTP/WS and Stream Deck servers, without starting ParaBus, connecting bots, or using audio hardware. [Verification and remaining checks](docs/VERIFICATION.md), [all dependency versions/licenses](docs/DEPENDENCIES.md). npm audit currently flags an upstream SDK dependency; see the verification report.
