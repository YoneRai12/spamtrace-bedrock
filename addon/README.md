# SpamTrace Addon

SpamTrace の Behavior Pack 本体です。

## 主な機能

- `player_join`, `join_resolved`, `player_spawn`, `player_leave` の記録
- 怪しい通常チャットの検出と記録
- `player.id` によるプレイヤー識別
- ブロック、信頼、隔離、緊急排除
- 証拠モードによる `chat_observed` 記録

## 使い方

1. `SpamTraceLoggerBP.mcpack` をインポートする  
   または
2. `sync-addon.cmd` を実行して、開発用ビヘイビアパックとして同期する

## 初回の管理者確定

ワールドを一度、あなた一人の状態で開いてください。  
その時点の `player.id` が管理者として記録され、以後は同じ本人を自動認識します。

## 主なコマンド

- `!st help`
- `!st status`
- `!st who`
- `!st list`
- `!st trusted`
- `!st settings`
- `!st export`
- `!st scan`
- `!st block name "<exactName>" "<reason>"`
- `!st blockid "<playerId>" "<reason>"`
- `!st trust name "<exactName>" "<reason>"`
- `!st trustid "<playerId>" "<reason>"`
- `!st kick "<exactName>"`
- `!st kickid "<playerId>"`
- `!st quarantine "<exactName>" "<reason>"`
- `!st quarantineid "<playerId>" "<reason>"`
- `!st lockdown on|off|status`
- `!st chatgate on|off|status`
- `!st evidence on|off|status`
- `!st mark "<note>"`
- `!st autoblock on|off|status`
- `!st emergency "<reason>"`

## 注意

- Bedrock ローカルワールドでは、真の送信元 IP を確定できません。
- このアドオンの `BAN` 相当は、ブロック登録と自動キックの組み合わせです。
