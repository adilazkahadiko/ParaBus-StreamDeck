# Stage 3 verification

## 0.1.3の確認（2026-11-19）

利用者の実機確認で、0.1.2では `VC Bus 10`～`VC Bus 20` が同じ `VC Bus…` になることが分かりました。0.1.3では半角8文字相当の上限と全角・省略記号を2と数える規則を保ち、末尾の番号・括弧つき番号を残します。まず番号の直前の空白だけを取り除き、まだ長ければ先頭を残り幅まで縮めて `…` と番号を続けます。`VC Bus 9` → `VC Bus 9`、`VC Bus 10` → `VC Bus10`、`VC Bus 20` → `VC Bus20`、`Long Mix 10` → `Long…10`、`配信用ミックス 10` → `配信…10`、`配信用ミックス (2)` → `配…(2)` です。末尾に番号がない名前は従来の末尾省略です。番号だけで上限を超える場合は、利用者の指定どおり幅8を優先して番号の後ろ側を残し、括弧は対で維持します。

mute/fader の設定画面の対象選択付近に「ボタンの表示名（任意） / Button label (optional)」を追加しました。手入力された `label` だけをボタン設定に保存します。settings の検証で改行・制御文字と前後の空白を除去し、Unicodeコードポイント32個までに制限し、空はキーごと省きます。ラベルにも同じ表示幅と末尾番号の省略規則を適用します。空欄への変更で自動名に戻り、古い `label` なしの設定も動作します。状態更新で入力途中のラベルを上書きせず、Discord／API由来の参加者名やBus名は引き続き保存しません。emergency は設定欄ごと非表示であり、タイトル・エラー・dB・ステップと既定フォントは変更していません。

Node **v24.20.0** で `node --test tests/*.test.mjs` は **157成功、失敗・skip・cancelledは0**、`npx.cmd --no-install tsc --noEmit` は成功しました（PowerShellでは同じnpxの`.cmd`を使用）。9件の追加テストで番号の省略、Bus 9/10/20、ラベルの検証・保存・削除・復元、全対象のタイトル、3種類の設定画面と旧設定を確認しました。既存のSDK試験も拡張し、実SDK経由のラベル反映と検証済みラベルだけの保存、API名・ラベル・Tokenをログに出さないことを確認しました。すべて架空の名前・IDとmockサーバーを使用しています。

`build` / `streamdeck validate` / `streamdeck pack` は成功しました。manifest は `0.1.3.0`、package.json と lockfile のプロジェクト版は `0.1.3`、依存関係の版は従来どおりです。配布物は従来と同じ20ファイルです。ローカルの新規フォルダー `dist/button-labels-0.1.3-20261119-174550/` に実機確認用パッケージと `titles-72px.png` を作成しました。72pxプレビューにはBus 9/10/20、全角の長い名前＋番号／括弧つき番号、手入力ラベルを並べ、0.1.2と0.1.3を比較しています。Arialサイズ9・行高11pxで3行33px、今回の6例の最大行幅は約40.6pxでした。これはオフラインのブラウザー描画であり、0.1.3の実機確認ではありません。

起動中のParaBus／Stream Deckの終了・再起動、インストール、Bot接続、音声開始、指定された運用フォルダーへのアクセスは行っていません。この修正はcommitまでとし、push・タグ・Releaseは行いません。

## 0.1.2の確認（2026-11-19）

mute/fader の正常時タイトルに操作対象名を追加しました。固定ユーザーと slot の現在のユーザーは、`registeredUsers`、`participants` の順で許可された表示名を解決し、名前がない／許可がない場合は `…` と ID の末尾4桁を表示します。Bus は inspector と共通の関数で label・種類と一覧順による代替名・重複番号を決め、TX は現在の `tx.bots` の順による `TX N` を表示します。名前は次の state 更新で更新し、設定には保存しません。emergency と未接続・エラーのタイトル文字列および画像は従来どおりです。

制御文字（C0/C1、書式制御、Unicode の行・段落区切りを含む）を取り除き、名前を**半角8文字相当**に制限しました。全角・幅が曖昧な文字・省略記号 `…` は2として数え、省略記号を含めて上限以内にします。72px のオフライン画像検証では、当初の半角10文字／フォント12は `W` 10個が約113.3pxとなり、3行の名前がアイコンに重なりました。mute/fader の既定フォントを **Arial / サイズ9** に調整し、8個の `W` が約68.0px、3行が行高11pxで33pxに収まることを確認しました。emergency のフォント設定は変更していません。これはブラウザーの SVG/Canvas で作った72pxプレビューであり、Stream Deck の実機描画確認ではありません。利用者のインストール後の実機確認が残ります。Stream Deck 側で上書き済みのフォント設定にも適合を保証しません。

Node **v24.20.0** で `node --test tests/*.test.mjs` は **148成功、失敗・skip・cancelledは0**、`npx.cmd --no-install tsc --noEmit` は成功しました（PowerShell の実行ポリシーにより `.ps1` ではなく同じ npx の `.cmd` を使用）。新しい12テストと既存の inspector・操作・SDK 試験で、名前の解決順、権限、slot の入れ替わり、Bus の重複、TX の順序、文字制限、3行形式、エラーの維持を検証しました。実 SDK transport の試験では名前付きタイトルが送られること、名前が action/global settings・stdout/stderr・SDK ログに残らないことも確認しました。すべて架空の名前・ID と mock サーバーを使っています。

`build` / `streamdeck validate` / `streamdeck pack` も成功しました。配布物は従来と同じ20ファイルです。配布物と72pxプレビューはローカルの新規フォルダー `dist/title-names-0.1.2-20261119-164104/` に作成しました。アプリのインストール・終了・再起動、Bot 接続、音声開始、運用フォルダーへのアクセスは行っていません。commit のみを作り、push・タグ・Release・GitHub 設定変更は行いません。

## 0.1.1の確認（2026-11-18）

参加者選択を`registeredUsers`の`select`に変更しました。許可された名前とオンライン印、名前を読めない場合のID、保存済みだが見つからないID、ID直接入力をDOM/WSハーネスで確認しました。Bus名は任意の`label`として読み、参加者名と同じ制御文字除去・80文字制限を行います。不許可なら名前を捨て、Busとslot範囲の表示には種類と全Bus一覧の順序による代替名を使います。保存するのは従来のID・設定キーだけで、名前はaction settingsにもglobal settingsにも保存しません。

接続試験はmock ParaBusだけを使います。4001ごとに認証付き`GET /state`を一度確認し、200なら即再接続、401なら`UNAUTHORIZED`で停止します。HTTP確認後の再接続から2秒以内に4001が再発した場合、または直近60秒で6回目の確認になる場合は、追加のHTTP確認をせず停止します。60秒経過した履歴は集計対象から外れ、明示的な接続設定でも履歴をリセットします。30秒の安定接続を要求していた旧0.1.1の制限は撤廃しました。10秒間隔の3回連続復帰、2000msでの停止・2001msでの復帰、60秒内の上限と期限切れ、HTTP 401での停止、確認中に4種類のボタンを押しても操作の送信・予約がないことを確認しました。4005は権限変更として待ち時間なしでinfo/stateを取り直します。どの経路からも操作を再送しません。beta.6互換の4001処理が、下記0.1.0の4001即停止方針を置き換えます。

PIのstatusにstateの有無を渡し、保存済みの参加者・Bus・slot範囲のIDはstateがなければ「未接続」、stateがあって選択肢に存在しなければ「見つかりません」と表示します。初期設定反映、接続状態の変化、PIソケット切断でもID値を変えずに文言が変わることを確認しました。

実アプリは起動・終了・再起動せず、利用者の設定・運用フォルダーを変更しません。Bot接続と音声ストリームの開始も行いません。実機の見た目・操作確認は利用者による確認待ちです。以下の2026-11-16の実機記録は0.1.0のもので、0.1.1の実機確認済みという意味ではありません。

Node 24.22.1での自動試験: **136成功、失敗・skip・cancelledは0**。typecheck / test / validate / packはすべて成功しました。packのファイル一覧は従来と同じ20個で、追加・削除はありません。依存の版・構成は変えず、0.1.1に向けたpackage-lockの変更もプロジェクト版数だけです。

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

## ParaBus beta.6候補版とStream Deck MK.2の実機確認

**確認日: 2026-11-16。** 利用者からの実機確認報告に基づく記録です。ParaBus beta.6候補版とStream Deck MK.2の実機で、次を確認済みです。

- 参加者のMIX（Send）のミュートとフェーダー。DiscordユーザーID指定とSlot指定の両方。
- Busのミュートとフェーダー。
- 緊急ミュートON。
- 操作がParaBusの画面へすぐ反映されること。

表示名、ユーザーIDの実値、トークンは記録しません。この記録の追記時にCodexがアプリを起動・終了したり、Botへ接続したり、音声ストリームを開始したりしたものではありません。
