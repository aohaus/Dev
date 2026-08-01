# Water

水の流れる音・穏やかな波の音・雨の音。この3つだけを流す、World App向けのMini App。

- 広告なし
- 説明不要のUI（アイコン3つのみ、タップで再生/停止、複数同時再生も可）
- すべての音はWeb Audio APIでのリアルタイム生成（固定ループ音源を使わないため、聞いていて「パターン」を覚えることがない）
- 各音に、確率的・低頻度・低音量で自然音のレイヤーを追加（水=遠くの鳥の声、波=風、雨=遠雷）
- 善意の寄付として、World App内でのみ1 WLDの送金ボタンを表示（MiniKitの`pay`コマンド）

## 既知の制約（コードでは解決できない）

- **画面ロック時の音の継続**: World AppのMini AppはWebView上で動作するため、ネイティブアプリのようなバックグラウンド再生セッションを持てない。Media Session APIで「再生中」であることをOS側に伝える best-effort 対応はしているが、World App側の実装次第で画面ロック後に音が止まる可能性がある。
- **すぐに探せない問題**: World Appのアプリ一覧からの起動が基本になる（お気に入り登録で軽減可）。Mini App単体でもPWAとしてホーム画面に追加可能なので、`manifest.json`を用意している。

## セットアップ

```bash
npm install
cp .env.example .env.local
npm run dev
```

`http://localhost:3000` を開くと、World App外のブラウザでも音自体は確認できる（寄付ボタンはWorld App内でのみ表示）。

## World App Mini Appとして登録する手順

1. [World ID Developer Portal](https://developer.worldcoin.org) でアカウント作成し、新しいMini Appを作成してApp IDを取得
2. `.env.local` の `NEXT_PUBLIC_WORLD_APP_ID` にApp IDを設定
3. 寄付を受け取るウォレットアドレスを `NEXT_PUBLIC_DONATE_ADDRESS` に設定（World Chain上でWLDを受け取れるアドレス）
4. 本アプリをVercel等HTTPSの公開URLにデプロイ（下記）
5. Developer Portalの Configuration > Basic で、公開したURLを「App URL」として設定
6. アプリ名（Water）・アイコン（`public/icon.svg`を参考にPNG等へ変換）・説明文をDeveloper Portal上で設定して審査に提出

## Vercelへのデプロイ

このセッションにはVercelアカウントの認証情報がないため、デプロイは以下の手順を実行してください。

```bash
npm i -g vercel
vercel login
vercel --prod
```

デプロイ後、Vercelのプロジェクト設定で環境変数 `NEXT_PUBLIC_WORLD_APP_ID` と `NEXT_PUBLIC_DONATE_ADDRESS` を設定し、再デプロイする。

## 構成

```
src/lib/audio/        音生成エンジン（water / waves / rain）とスケジューラ
public/worklets/       AudioWorkletのノイズ生成プロセッサ
src/components/        UIコンポーネント（丸ボタン、寄付ボタン、アイコン）
src/app/providers.tsx  MiniKitProviderのセットアップ
```
