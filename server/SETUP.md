# MEDAL BANK サーバーの設定手順（Cloudflare Workers）

メダルバンクの預け入れ残高と記録を、どの端末からでも「なまえ＋パスワード（3桁）」で使えるようにするためのサーバーです。
手持ちメダル・じゃんけんのカード・サービスメダルは、これまでどおり端末ごとです。

所要時間は 15 分ほどです。費用はかかりません（Cloudflare の無料プラン）。
※ Cloudflare の画面は時々変わります。ボタンの名前が少し違っていたら、近い名前のものを選んでください。

## 1. Cloudflare のアカウントを作る

1. https://dash.cloudflare.com/sign-up を開き、メールアドレスとパスワードで登録します（クレジットカードは不要です）。
2. 届いた確認メールのリンクを開きます。

## 2. データの保存場所（KV）を作る

1. 左のメニューから **Storage & Databases → Workers KV**（または **KV**）を開きます。
2. **Create**（Create instance / Create namespace）を押し、名前に `MEDAL_BANK` と入れて作成します。

## 3. サーバー（Worker）を作る

1. 左のメニューから **Workers & Pages** を開き、**Create**（Create application）を押します。
2. **Start with Hello World!**（Hello World テンプレート）を選びます。
3. Worker の名前に `medal-bank` と入れて **Deploy** を押します。
4. できた Worker の画面で **Edit code** を押します。
5. 左側の `worker.js`（または `index.js`）の中身を**すべて消して**、このリポジトリの
   [`server/medal-bank-worker.js`](medal-bank-worker.js) の中身を**まるごと貼り付け**ます。
6. 右上の **Deploy** を押します。

## 4. サーバーと保存場所をつなぐ

1. Worker（`medal-bank`）の画面で **Settings → Bindings**（または Variables）を開きます。
2. **Add** → **KV namespace** を選びます。
3. **Variable name** に `DB`（大文字）と入れ、**KV namespace** に手順2で作った `MEDAL_BANK` を選んで保存（Deploy）します。

## 5. 動作確認と URL の連絡

1. Worker の画面に表示されている URL（`https://medal-bank.〇〇〇.workers.dev`）を開きます。
2. `{"ok":true,"service":"medal-bank"}` と表示されれば成功です。
3. この URL を Claude に伝えてください。ゲーム側に設定して公開します。

## うまくいかないとき

- URL を開いて `no_kv_binding` と出る → 手順4の `DB` の名前（大文字）と KV の選択を確認してください。
- 別のサイトから使いたい場合 → **Settings → Variables** に `ALLOWED_ORIGIN` を追加し、サイトのアドレス（例 `https://aohaus.github.io`）を入れます。複数ならカンマ区切り。何も設定しなければ `https://aohaus.github.io` からだけ使えます。

## 知っておいてほしいこと

- **パスワードの保護**：パスワードはサーバー側で確認し、5回続けてまちがえると15分ロックされます。3桁なので本格的な防犯ではなく、「ほかの人がうっかり使わない」ための鍵です。
- **無料枠**：Workers KV の無料枠は書き込みが 1日1,000回ほどです。預け入れ・引き出し・ログインなどで書き込みます。家族で遊ぶ分には十分です。
- **反映のずれ**：KV は世界中にコピーされる仕組みのため、別の場所の端末に反映されるまで最大1分ほどかかることがあります。2台で同時に預け入れ・引き出しをすると、まれに片方が反映されないことがあります。
- **データの確認**：Workers KV の `MEDAL_BANK` を開くと、保存されたデータ（`u:` で始まるのがユーザー）を見られます。
