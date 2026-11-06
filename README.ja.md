# ParaBus Stream Deck プラグイン

ParaBus 外部操作 API v1 を使う段階3の最初の版です。Windows 10 以降、Stream Deck アプリ 7.1 以降、Stream Deck MK.2 のボタンを対象にします。ライセンスは GPL-3.0-only（[LICENSE](LICENSE)）です。

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
5. **Connect / 再接続** を押し、`CONNECTED` と「設定済み」を確認します。接続設定は全ボタン共通です。

登録・有効化は利用者が ParaBus のローカル画面で行います。プラグインには機器登録機能を設けていません。トークンを失った場合は ParaBus 側で再発行して入力し直します。取り消し・再発行後は旧トークンを使用できません。

## ボタンの設定

Stream Deck の ParaBus カテゴリーからボタンを配置し、対象を設定して **Save button / ボタンを保存** を押します。

| ボタン | 対象と動作 |
| --- | --- |
| Toggle Mute | 参加者・Bus・Send のミュートを反転。現在の `mute` を `expectedMute` に使用し、`STALE_REVISION` の `current.mute` で表示を訂正。自動再送しません |
| Fader Up / Down | 参加者・Bus・Send・TX に1回だけ `*.fader.adjust`。既定1 dB、0超〜6 dBでボタンごとに設定（1 / 2 / 3 / 6 dBなど）。現在の dB を表示 |
| Emergency Mute ON | `emergency.set({active:true})` のみ。緊急ミュートの有効状態を表示。解除は ParaBus で行います |

参加者は17〜20桁の Discord ユーザー ID（文字列）または1始まりの slot を選択します。slot は全員、または VC Bus 内の現在の並び順です。並び順と `expectedParticipantsRevision` は最新 state から取得し、設定には保存しません。オフラインの参加者や存在しない Send には送信を予約しません。

Bus は state から得た ID を選択します。`external-bus:...` の別名はそのまま保存し、ラベルや Discord の内部 ID から生成しません。ParaBus 側で別名鍵を変更した場合は選択し直します。Send と slot の範囲は VC Bus を選択します。TX は `profileId` で選択します。`NO_BOT` は表示し、操作を送りません。

ボタン設定に保存するものは対象種別、対象 ID、slot の範囲・番号、一回の量だけです。参加者表示名は `readDisplayNames` が許可されたときだけ候補の文字列として表示し、保存しません。

## 切断・エラー

切断時は `OFFLINE`、未設定は `SETUP`、認証エラーは `401 AUTH`、無効化は `DISABLED`、理由通知なしの安全停止は `STOPPED` と表示します。`RATE LIMIT` や `INVALID` などの操作失敗は約1.5秒表示します。流量制限後は `Retry-After` の間、通常操作を新たに送信しません。緊急ミュートは別の安全操作枠を使えるよう、この待機の対象外です。

通常の再接続は1秒から最大30秒の指数バックオフと jitter です。再接続と起動 ID の変更では info / state を取り直します。401、DISABLED、WS の4001/4003では自動再接続を止めます。原因を解消して **Connect / 再接続** を押してください。close code だけから過去の操作の成功は推測しません。

1回の押下につき新しい UUID の `requestId` を発行します。この版は通信エラーでも操作を自動再送せず、過去の操作キューも作りません。結果不明時は接続後に state と意図を確認して手で押し直します。切断・停止・終了時にミュート解除、フェーダー復元、TX 停止などの音声状態を変える命令は送りません。

## トークンの扱い

- トークンの保存先はプラグインの **global settings** だけです。Stream Deck が管理するローカル設定であり、暗号化や OS の資格情報保管庫による保護は保証しません。アプリの設定フォルダーとバックアップの管理に注意してください。
- ボタンごとの action settings には保存しません。設定入力は許可フィールドだけ取り出して保存します。旧設定などに余分なフィールドがあれば、ボタン表示時に取り除きます。
- Property Inspector は ParaBus API を直接呼びません。Stream Deck の登録用 WS を通じて本体に入力を渡します。トークンの値を送り返さず、「設定済み」かどうかだけ返します。新しいトークンの入力欄は送信後や切断時に消去します。空欄で接続保存すると既存トークンを保持します。
- ログ、ボタンのタイトル、API エラー表示にトークンを出しません。SDK が生の通信を記録し得るため、SDK のログ書き込み口も固定文に制限し、実際の SDK 経路で試験しています。
- **Remove token / トークン削除** はプラグインの保存値を削除します。ParaBus 側の機器の取り消しは別途必要です。実トークンをコード、スクリーンショット、Issue、チャット、コマンド引数に入れないでください。

## プロファイル書き出しの手動確認

実際の Stream Deck アプリでのエクスポートはメンテナーが確認します。自動試験での action settings の確認と、この確認は別です。**本作業では実機での書き出しを実施していません。配布前の確認事項です。**

1. 確認専用の機器を ParaBus 側で登録し、試験用の新しいトークンを取得します。通常利用のトークンと分け、値の記録・共有はしません。
2. このプラグインを実際の Stream Deck アプリへ導入し、そのトークンを共通の接続設定に保存します。各種類のボタンを含む専用プロファイルを作り、対象・一回の量を保存します。
3. アプリを再起動し、トークンは「設定済み」、入力欄は空欄であることを確認します。接続が必要なら ParaBus 側で外部操作を明示的に有効化します。
4. Stream Deck のプロファイル管理から専用プロファイルを `.streamDeckProfile` に書き出します。保存先はリポジトリや同期対象外のローカルの確認用フォルダーとします。
5. エクスポートを ZIP 対応のローカルアーカイバーで開き、全ファイルと入れ子のアーカイブを展開して調べます。JSON の action settings が対象 ID と一回の量などだけであること、`token` / `Authorization` / global settings が含まれていないことを確認します。
6. ローカルのテキストエディターの検索機能で、発行された試験用トークンそのものが全展開ファイルに含まれないことを確認します。UTF-8 と UTF-16 のファイルも対象にします。検索結果・トークン・展開内容をターミナルや報告へ貼らず、アプリ版、日時、成功/失敗だけを記録します。
7. 別の確認用プロファイルへインポートし、対象設定が復元できることを確認します。同じ PC の既存 global settings による「設定済み」は、トークンが書き出されなかった証拠にはならないため、必ず手順5〜6でファイル自体を調べます。
8. トークンが含まれていた場合は配布を止め、機器を取り消します。global settings の採用を見直し、書き出されない保存先を用意して再検証します。確認後は試験用機器を取り消し、確認用ファイルを利用者の手順で削除します。

## 開発・確認記録

試験は HTTP／WS の模擬 ParaBus と模擬 Stream Deck ホストで行います。ParaBus 本体起動、Bot 接続、音声機器の使用は行いません。アイコンは独自の幾何図形で、SVG 原本と PNG を含みます。再生成は `node scripts/icons.mjs` と `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/plugin-icon.ps1` です。

[試験・ヘッダー・未完了の手動確認](docs/VERIFICATION.md)、[全依存の正確な版とライセンス](docs/DEPENDENCIES.md) を参照してください。現在の公式 SDK の間接依存に npm audit の指摘が残っています。互換性のない強制更新や SDK の旧版への変更は行っていません。
