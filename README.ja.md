# ParaBus Stream Deck プラグイン

ParaBus 外部操作 API v1 を使うプラグインです。0.1.1を準備中です。Windows 10 以降、Stream Deck アプリ 7.1 以降、Stream Deck MK.2 のボタンを対象にします。ライセンスは GPL-3.0-only（[LICENSE](LICENSE)）です。

このプラグインには **ParaBus v0.1.0-beta.6 以降**が必要です。beta.5以前には外部操作APIがありません。本体は[ParaBus beta.6の配布ページ](https://github.com/adilazkahadiko/ParaBus/releases/tag/v0.1.0-beta.6)から入手してください。

## 導入

開発用の Node.js 24 と npm を用意し、このリポジトリで実行します。Stream Deck アプリ内の実行用 Node はアプリ側が管理します。

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run validate
npm.cmd run pack
```

生成される `dist/io.github.adilazkahadiko.parabus.streamDeckPlugin` をダブルクリックしてインストールします。生成物、依存フォルダー、ログは git 対象外です。SDK は 3.0.4、CLI は 1.10.4 に固定しています。manifest の `Nodejs.Version` は `24` です。公式の現行ランタイム表の 24.22.1 で試験しています（[確認記録](docs/VERIFICATION.md)）。

## ParaBus 側での機器登録

1. 同じ PC の ParaBus の **SETUP → 接続する機器** で新しい機器を登録します。機器名は、例えば「Stream Deck」とします。
2. 一度だけ表示されるトークンを、Stream Deck の ParaBus ボタンの Property Inspector の **New token / 新しいトークン** に入力します。**Save connection / 接続を保存** を押すと欄は空になります。
3. ParaBus 側で外部操作を明示的に有効にします。ParaBus は起動ごとに無効になるため、再起動後も必要です。段階 B の権限は不要です。参加者の表示名が必要な場合だけ `readDisplayNames` を許可します。
4. ParaBus 側の外部 API ポートに合わせます。既定は `4175`、接続先は `127.0.0.1` 固定です。操作画面のポートとは別です。ParaBus 側のポート変更は再起動後に反映されます。
5. `CONNECTED` と「設定済み」を確認します。`DISABLED` の場合は5秒間隔で有効化を確認し、ParaBus 側で有効化すると自動で接続します。すぐに接続を試す場合はボタンまたは **Connect / 再接続** を押せます。接続設定は全ボタン共通です。

登録・有効化は利用者が ParaBus のローカル画面で行います。プラグインには機器登録機能を設けていません。トークンを失った場合は ParaBus 側で再発行して入力し直します。取り消し・再発行後は旧トークンを使用できません。

## ボタンの設定

Stream Deck の ParaBus カテゴリーからボタンを配置し、対象を設定して **Save button / ボタンを保存** を押します。

| ボタン | 対象と動作 |
| --- | --- |
| Toggle Mute | Bus・参加者の MIX（Send）のミュートを反転。現在の `mute` を `expectedMute` に使用し、`STALE_REVISION` の `current.mute` で表示を訂正。自動再送しません |
| Fader Up / Down | Bus・参加者の MIX（Send）・TX に1回だけ `*.fader.adjust`。既定1 dB、0超〜6 dBでボタンごとに設定（1 / 2 / 3 / 6 dBなど）。現在の dB を表示 |
| Emergency Mute ON | `emergency.set({active:true})` のみ。緊急ミュートの有効状態を表示。解除は ParaBus で行います |

**参加者の MIX（Send）** は、参加者 → 選択した VC MIX の On/Off とレベルを操作する対象です。参加者は17〜20桁の Discord ユーザー ID（文字列）または1始まりの slot を選択します。slot は全員、または VC Bus 内の現在の並び順です。並び順と `expectedParticipantsRevision` は最新 state から取得し、設定には保存しません。オフラインの参加者や存在しない Send には送信を予約しません。

0.1.1では、固定の参加者を`registeredUsers`のプルダウンから選びます。表示名の読み取りが許可されている場合は名前を表示し、オンラインの人には●を付けます。名前を読めない場合はユーザーIDを表示します。保存済みのIDが一覧にない場合も「ID（見つかりません）」として残します。まだ一覧にない人は「ID を直接入力 / Enter ID」を選び、入力欄へIDを入れてください。
前後の空白・大文字小文字を除いて参加者名が重なる場合は「名前 (…1234)」を●の前に付け、末尾4桁も重なる場合はID全体を表示します。Bus名の重複には「(2)」「(3)」を付け、いずれも表示だけに使い、保存しません。

旧 **Participant / 参加者**（`target: channel`）は、API の `channel.fader.*`・`channel.mute.*` の廃止に合わせて削除しました。保存済みの旧対象ボタンは `SETUP` を表示し、操作を送りません。対応する対象を選び直してボタンを保存してください。state の `participants[].faderDb`・`mute` は不要で、旧フィールドが残っていても使用しません。参加者の MIX（Send）は `participants[].sends[].db`・`mute` を使用します。

Busとslotの範囲は、許可されたBus名がstateにあれば名前で選べます。名前がなければ種類と並び順から「VC Bus 1」「Bus 2」のように表示します。beta.6はBus名を返さず、beta.7向けのParaBus修正で`readDisplayNames`許可時だけ追加します。値はstateから得たIDのままです。`external-bus:...` の別名はそのまま保存し、ラベルや Discord の内部 ID から生成しません。ParaBus 側で別名鍵を変更した場合は選択し直します。参加者の MIX（Send）の送信先と slot の範囲は VC Bus を選択します。TX は `profileId` で選択します。`NO_BOT` は表示し、操作を送りません。

ボタン設定に保存するものは対象種別、対象 ID、slot の範囲・番号、一回の量だけです。参加者名・Bus名は`readDisplayNames`が許可されたときだけ設定画面に表示し、ボタン設定にも全体設定にも保存しません。保存キーは従来の`target, participant, discordUserId, index, scopeBusId, busId, profileId, stepDb`のままです。

## 切断・エラー

切断時は `OFFLINE`、未設定は `SETUP`、認証エラーは `401 AUTH`、無効化は `DISABLED`、理由通知なしの安全停止は `STOPPED` と表示します。`RATE LIMIT` や `INVALID` などの操作失敗は約1.5秒表示します。流量制限後は `Retry-After` の間、通常操作を新たに送信しません。緊急ミュートは別の安全操作枠を使えるよう、この待機の対象外です。

通常の通信切断からの再接続は1秒から最大30秒の指数バックオフと jitter です。再接続と起動 ID の変更では info / state を取り直します。

`DISABLED` は `DISABLED` 表示のまま **5秒固定間隔** で `GET /info` を再試行します。/info・/state の DISABLED 応答、WS の DISABLED エラー、close 4003、`state.enabled=false` のすべてが対象です。この待機では指数バックオフを使いません。/info が成功した後だけ通常の state 取得・WS 接続へ進み、ParaBus 側の有効化後は利用者の操作なしで `CONNECTED` に戻ります。この再試行から /actions を送ることはありません。

`DISABLED`・`STOPPED`・`OFFLINE` などの未接続中にボタンを押すと、`CONNECT` を表示して即座に接続を1回試します。すでに試行中ならその接続試行を共有し、並列に増やしません。**その押下の操作は送信・保留せず、接続できても後から実行しません。** 操作したい場合は接続後に改めて押してください。予期しない非同期エラー（unhandledRejection）で停止した接続も、この押下で復帰できます。

HTTP 401 / `UNAUTHORIZED`では停止し、自動再試行もボタン押下からの再試行も行いません。WS close 4001は、beta.6では権限変更にも使われるため、受信ごとにトークン付きHTTPの`/state`で一度確認します。200なら即再接続し、401なら`UNAUTHORIZED`で停止します。ただし、その再接続から**2秒以内**に再び4001を受けた場合、または**直近60秒で6回目の確認**になる場合は、追加のHTTP確認をせず停止します。確認履歴は60秒で集計対象から外れ、明示的な接続設定でもリセットします。確認中の押下は操作を送信・予約せず消費します。新しいclose 4005（権限変更）は待ち時間なしで新しいinfo/stateを取得し、再接続します。操作の再送は行いません。

保存済みの参加者・BusのIDは、stateがない間は「ID（未接続）」と表示します。「ID（見つかりません）」は、stateを取得できていて選択肢に存在しない場合だけ表示します。保存するIDは変わりません。

トークン未設定（`SETUP` / `CONFIGURE`）でも接続を試しません。Property Inspectorで有効なトークンを入力して接続設定を保存してください。close codeから過去の操作の成否は推測しません。

1回の押下につき新しい UUID の `requestId` を発行します。この版は通信エラーでも操作を自動再送せず、過去の操作キューも作りません。結果不明時は接続後に state と意図を確認して手で押し直します。切断・停止・終了時にミュート解除、フェーダー復元、TX 停止などの音声状態を変える命令は送りません。

## トークンの扱い

- トークンの保存先はプラグインの **global settings** だけです。Stream Deck が管理するローカル設定であり、暗号化や OS の資格情報保管庫による保護は保証しません。アプリの設定フォルダーとバックアップの管理に注意してください。
- ボタンごとの action settings には保存しません。設定入力は許可フィールドだけ取り出して保存します。旧設定などに余分なフィールドがあれば、ボタン表示時に取り除きます。
- Property Inspector は ParaBus API を直接呼びません。Stream Deck の登録用 WS を通じて本体に入力を渡します。トークンの値を送り返さず、「設定済み」かどうかだけ返します。新しいトークンの入力欄は送信後や切断時に消去します。空欄で接続保存すると既存トークンを保持します。
- ログ、ボタンのタイトル、API エラー表示にトークンを出しません。SDK が生の通信を記録し得るため、SDK のログ書き込み口も固定文に制限し、実際の SDK 経路で試験しています。
- **Remove token / トークン削除** はプラグインの保存値を削除します。ParaBus 側の機器の取り消しは別途必要です。実トークンをコード、スクリーンショット、Issue、チャット、コマンド引数に入れないでください。

## プロファイル書き出しの手動確認

**2026-11-16 実施済み。** 実際の Stream Deck アプリで書き出したプロファイルを検査し、トークンが含まれないことを確認しました。ParaBus のボタン設定の項目は `target`・`participant`・`discordUserId`・`busId`・`stepDb` のみでした。トークンと同じ形の文字列は、`busId` の `external-bus:` 別名だけでした。

## 開発・確認記録

試験は HTTP／WS の模擬 ParaBus と模擬 Stream Deck ホストで行います。ParaBus 本体起動、Bot 接続、音声機器の使用は行いません。アイコンは独自の幾何図形で、SVG 原本と PNG を含みます。再生成は `node scripts/icons.mjs` と `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/plugin-icon.ps1` です。

[試験・ヘッダー・手動確認の記録](docs/VERIFICATION.md)、[全依存の正確な版とライセンス](docs/DEPENDENCIES.md) を参照してください。現在の公式 SDK の間接依存に npm audit の指摘が残っています。互換性のない強制更新や SDK の旧版への変更は行っていません。
