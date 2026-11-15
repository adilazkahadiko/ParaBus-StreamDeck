# Stage 3 verification

Automated mock verification was first performed locally on Windows, 2026-11-07 (JST), and rerun for the API update on 2026-11-16. The completed profile-export inspection is recorded below.

## Contract and scope

Original read-only source: `C:/Dev/ParaBus-public/docs/EXTERNAL_CONTROL_API.md`, main commit `bd9a793bfd4e27c6685c355ab219f0f8fd968bbe`. The 2026-11-16 update follows the maintainer-supplied API change being prepared in parallel: remove `channel.fader.*`, `channel.mute.*`, and participant-level `faderDb` / `mute`. ParaBus-public was only read; no source repository files were edited. The old private repository and run folders were not accessed. ParaBus itself was not launched; no bot or audio device was used.

Plugin UUID: `io.github.adilazkahadiko.parabus`. Four Keypad actions: `.mute`, `.fader-up`, `.fader-down`, `.emergency`. No encoder handlers, Stage B operations, emergency release, absolute fader writes, or action retry queues are implemented. Every accepted press sends a fresh UUID. No automatic action retry is implemented, including on communication errors; therefore an ambiguous request is never resubmitted with a new ID.

## Versions and licenses

The npm `latest` dist-tags were checked using `npm.cmd view` and exact versions were installed. `package-lock.json` pins transitives too. There are two direct runtime dependencies and five direct development dependencies.

| Direct dependency | Exact version | License | Purpose |
| --- | --- | --- | --- |
| @elgato/streamdeck | 3.0.4 | MIT | Official SDK |
| ws | 8.22.1 | MIT | Authenticated ParaBus WS; also deduplicated with the SDK's WS dependency |
| @elgato/cli | 1.10.4 | MIT | Official validation and pack |
| typescript | 7.0.2 | Apache-2.0 | Type checking |
| esbuild | 0.28.2 | MIT | Bundle Node plugin and compile test exports |
| @types/node | 24.19.2 | MIT | Node 24 types |
| @types/ws | 8.18.2 | MIT | WS types |

[DEPENDENCIES.md](DEPENDENCIES.md) lists all 124 locked package entries, including transitive and optional platform packages. Runtime transitives are `@elgato/schemas` 0.6.0, `@elgato/utils` 0.6.2, and `zod` 3.25.76, all MIT. Bundled license texts are generated into the pack's `THIRD_PARTY_LICENSES.txt`; the plugin's GPL license is included too.

**Known dependency issue:** npm audit reports three high-severity affected package entries, all from one upstream advisory, [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): `zod`, propagated through `@elgato/utils` to `@elgato/streamdeck`. The SDK's declared dependency uses Zod 3; the advisory's fixed version is 4.6.6. No incompatible major override or SDK downgrade was applied. This remains an upstream dependency limitation, not a clean audit. The local ignored audit JSON is `dist/npm-audit.json`.

## Runtime and transport selection

Manifest: `Nodejs.Version: "24"`, `Software.MinimumVersion: "7.1"`, Windows 10+. The [official runtime table](https://docs.elgato.com/streamdeck/sdk/introduction/plugin-environment/) lists Node **24.22.1** for current Stream Deck releases, including 7.1's automatically updated runtimes. [SDK v3 requires Stream Deck 7.1+](https://docs.elgato.com/streamdeck/sdk/upgrading/v3/). The major is fixed by the manifest; Stream Deck manages patch updates.

A standalone official Windows x64 Node 24.22.1 executable was downloaded under ignored `.tools/`, checked against the official `SHASUMS256.txt`, and used to run the final test suite and its actual bundled SDK child process. That automated run did not launch the Stream Deck app or verify its installed runtime.

Node's browser-compatible global WebSocket does not expose arbitrary handshake headers. `ws` supports `Authorization: Bearer` in client options and is already required by the official SDK, so the plugin uses that exact deduplicated package. [ws client options](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options) document the Node HTTP options used for headers. HTTP uses `node:http`, avoiding fetch metadata entirely. Both clients fix the host to `127.0.0.1` and do not follow redirects. Requests have bounded response sizes and deadlines. The WS client answers server pings through ws, expects the initial state within 5 seconds and observes a 45-second liveness deadline.

## Actual observed request headers

Captured at the mock server from the production `ParaBusClient`, on Node **v24.22.1**, with a randomly generated in-memory credential. Authorization **values were neither recorded nor printed**. Machine-readable output (header names and boolean checks only): ignored `dist/header-report.json`.

| Request | Observed header names |
| --- | --- |
| GET /external/v1/info | authorization, connection, host |
| GET /external/v1/state | authorization, connection, host |
| POST /external/v1/actions | authorization, connection, content-length, content-type, host |
| WS upgrade /external/v1/ws | authorization, connection, host, sec-websocket-key, sec-websocket-version, upgrade |

For every request: Bearer present and correct; Host exactly `127.0.0.1:<configured port>`; no `Origin`; no header starting `Sec-Fetch-`; no credential in URL or WS subprotocol. These findings address the client-header uncertainty in contract §17 for this implementation and Node version. The browser inspector connects only to Stream Deck's registration socket; it does not contact ParaBus.

## Automated checks

Final automated result (2026-11-16): **114 passed / 0 skipped / 0 failed**, 0 cancelled. Tests run without the Stream Deck app. Previous participant-control cases now exercise supported Send operations; the assertions for DISABLED / close 4001 / close 4003 follow the maintainer's updated connection policy described below.

- 8 mute cases cover Bus and Send (fixed user, all-participant slot, VC Bus slot): operation/args, latest expectedMute, distinct UUIDs, and STALE current.mute correction without resend.
- 40 fader cases cover Bus, Send (fixed user, all-participant slot, VC Bus slot) and TX, up/down with 1/2/3/6 dB, exact relative args and displayed resulting dB.
- Six legacy `target: channel` cases cover mute/up/down with user/slot settings: sanitized settings have no target, direct target resolution fails, attach/update show SETUP, and presses send no requests even after stopping the connection. The bundled SDK additionally verifies sanitization, SETUP and no actions through both willAppear and didReceiveSettings.
- The default mock state omits participant-level faderDb/mute and advertises no channel operations; unsupported actions are rejected. State parsing also ignores malformed legacy fields while still requiring Send mute. The PI excludes the channel option, describes Participant MIX (Send) as participant → VC MIX on/off and level, and requires explicit target selection for sanitized legacy settings.
- Emergency ON is checked on repeated presses, with state display and no release operation.
- INVALID/RATE_LIMITED and HTTP, WS upgrade, WS message authentication/disabled failures are checked. 401 / close 4001 latch; DISABLED / close 4003 use fixed five-second probes. Rate limit honors Retry-After for new normal presses.
- Backoff timing uses a deterministic clock: 1/2/4/8/16/30-second sequence, jitter bounds, retry growth, short-lived connection flapping and reset after 30 stable seconds. Instance changes refetch info/state. Old state revisions are ignored. Initial WS state timeout is covered.
- Disconnect, stop and ambiguous HTTP action results never replay operations. Slots use current participantsRevision. Missing sends/users and NO_BOT never send. A second pending press is rejected, not queued. A late STALE response does not overwrite newer WS state or a newly configured target.
- The production SDK bundle is spawned against a fake Stream Deck registration socket. All four actions are dispatched through the actual SDK. Action settings, outgoing PI payloads, titles, stdout/stderr and SDK log files are checked for the ephemeral token, including the SDK's malformed-message error path.
- Inspector JavaScript runs in a DOM/WS harness: only the Stream Deck socket is opened; password input is cleared after send/disconnect; button-save messages exclude the token; inputs are validated; display names are rendered with textContent. The readDisplayNames permission gates name projection and names are never saved.

### Disabled polling and press-to-connect update

The maintainer explicitly changed the initial DISABLED-stop policy to accommodate ParaBus disabling external control at every startup. This client policy update does not change the read-only ParaBus contract or enable external control remotely.

- DISABLED from HTTP /info, /state, WS upgrade, WS error, close 4003 or state.enabled=false enters fixed **5000 ms** polling. The display remains DISABLED, including during probes and temporary network failures. Every probe begins with GET /info; subsequent state/WS setup runs only after it succeeds. No polling path sends /actions.
- Seven source-specific cases each advance a deterministic clock through four 4999+1 ms boundaries, asserting that only GET /info arrives during the disabled period, there is no jitter/backoff, and enabling the mock server restores CONNECTED without user input.
- Twelve cases cover all four button kinds in DISABLED, STOPPED and OFFLINE: the press cancels a pending retry delay, immediately attempts a connection, shows CONNECT, and is consumed. Successful connection never replays that action; a separate subsequent press sends exactly one operation. Repeated presses during an in-flight connection share the attempt.
- UNAUTHORIZED, close 4001 and CONFIGURE are checked against all four button kinds: no automatic or press-triggered requests. A valid token must be supplied through settings. Explicit stop cancels disabled polling.
- The actual bundled SDK child process receives a real unhandled rejection through a test-only Node preload/IPC channel. It stops the client but retains visible button registrations. A later real SDK keyDown reconnects, shows CONNECT and sends no action; a subsequent keyDown performs one action. The production plugin contains no rejection-injection hook.

Successful commands:

```powershell
npm.cmd run typecheck
npm.cmd test
.tools/node24.exe scripts/build.mjs
.tools/node24.exe scripts/build-tests.mjs
.tools/node24.exe --test --test-reporter=spec tests/*.test.mjs
npm.cmd run validate
npm.cmd run pack
```

Official CLI validation and packing both succeed without bypassing validation. Per [official distribution documentation](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/), packing uses `streamdeck pack`. Local artifact:

`C:/Dev/ParaBus-StreamDeck/dist/io.github.adilazkahadiko.parabus.streamDeckPlugin`

The installer and compiled outputs are ignored and are not committed.

## Secrets and identity

No real ParaBus credential was used or found in the authored files. Mock credentials are generated in memory, transmitted only on the mock authorization / global-setting / input paths, and excluded from diagnostics. Dependency and contract examples are not production credentials. No token hash or bearer value is included in this report.

Git identity is copied from the source repository into this repository's **local** config. Both values match the source; the email also matches the public GitHub account's noreply address, checked without printing it. At the initial local verification, there was no remote and no push had been performed.

## Profile-export manual verification

**Completed 2026-11-16.** A profile exported from the actual Stream Deck app was inspected; no token was present. ParaBus button settings contained only `target`, `participant`, `discordUserId`, `busId`, and `stepDb`. The only token-shaped strings were `external-bus:` aliases in `busId`.
