# SpamTrace for Minecraft Bedrock

[![English README](https://img.shields.io/badge/README-English-2563eb?style=for-the-badge)](README.en.md)

Minecraft Bedrock 統合版のローカルホスト向けに、参加者の挙動と怪しいチャットを記録し、手元の Web UI から封じ込め操作を行うための調査ツール集です。

## 含まれるもの

- `addon/`: Behavior Pack 本体
- `dashboard/`: Content Log を読むローカル Web ダッシュボード

## できること

- 参加、スポーン、退出、怪しいチャットの記録
- `player.id` ベースの安定したプレイヤー識別
- ブロック、信頼、隔離、緊急排除の補助
- 証拠モードによる通常チャット送信者ログ
- Content Log とホスト PC 視点の通信観測をまとめて確認

## できないこと

- ローカルワールドで参加者の真の IP を確定すること
- Microsoft リレーや NAT の内側まで追うこと
- Bedrock ローカルワールドで完全な恒久 BAN を提供すること

## クイックスタート

1. `addon/SpamTraceLoggerBP.mcpack` を導入するか、`addon/sync-addon.cmd` で開発用パックとして同期します。
2. ワールドをあなた一人の状態で一度開きます。
3. `dashboard/` で `npm start` または `start-dashboard.cmd` を実行します。
4. ブラウザで `http://127.0.0.1:3984` を開きます。

## 管理者判定

このツールは `/tag` ではなく `player.id` を主に使います。  
最初にワールドを単独で開いたプレイヤーを管理者として記録し、その後は同じ `player.id` を持つ本人を自動で管理者扱いします。  
人狼系アドオンが `/tag` を消しても、通常は影響しません。

## 公開方針

このリポジトリには、個人のワールド ID、ローカルのログ実体、個人アカウント名に依存する設定は含めていません。  
Windows 上の Bedrock ローカルホスト運用を前提にした汎用版だけを公開しています。

## ライセンス

MIT License
