# ParaBus for Stream Deck

GPL-3.0-only. First Stage 3 release for Stream Deck MK.2 buttons on Windows 10+ and Stream Deck 7.1+. Uses the official Node.js SDK, with manifest Node.js **24**. See [日本語](README.ja.md).

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

Tokens are stored **only in plugin global settings**, never action settings. The inspector sends new input to the plugin and only receives a configured/not-configured flag. Global settings are managed by Stream Deck; this does not promise encryption. Protect local app data, revoke tokens when needed, and keep tokens out of source control. Maintainers must perform the [profile-export check](README.ja.md#プロファイル書き出しの手動確認) before distribution.

Mute uses current state and `expectedMute`; a stale reply corrects the display without retrying. Each fader press sends one relative adjustment (default 1 dB, configurable up to 6 dB). Emergency only enables mute; release it in ParaBus. No action is retried or queued automatically.

While external control is disabled (including WS close 4003), the plugin keeps showing `DISABLED` and checks `GET /info` every **5 seconds**, without exponential backoff or sending actions. After ParaBus is enabled, it completes the normal connection automatically. An offline key press shows `CONNECT` and attempts a connection immediately; that press is consumed and never runs an action after connecting. Press again once connected to operate. This also recovers a connection stopped by an unhandled rejection. Missing configuration and authentication failure (401 / WS close 4001) do not retry automatically or on key presses: enter a valid token in the inspector first.

Tests use mock HTTP/WS and Stream Deck servers, without starting ParaBus, connecting bots, or using audio hardware. [Verification and remaining checks](docs/VERIFICATION.md), [all dependency versions/licenses](docs/DEPENDENCIES.md). npm audit currently flags an upstream SDK dependency; see the verification report.
