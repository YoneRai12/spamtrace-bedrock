# SpamTrace Dashboard

SpamTrace アドオンが Content Log に出力した情報を読む、Windows 向けのローカル Web ダッシュボードです。

## 機能

- Content Log から SpamTrace イベントを読み取る
- 怪しいプレイヤーを一覧化する
- `!st` コマンドを Minecraft ウィンドウへ送る
- ホスト PC 視点の TCP / UDP 観測を表示する
- 証拠モードや手動マーカーを UI から切り替える

## 起動方法

1. Minecraft Bedrock で SpamTrace アドオンを有効化する
2. `npm start` または `start-dashboard.cmd` を実行する
3. `http://127.0.0.1:3984` を開く

## 前提

- Windows
- Minecraft Bedrock
- PowerShell
- Node.js 18 以降

## 注意

- この UI が読めるのは Content Log に書かれた SpamTrace 情報だけです。
- ここで見える通信先はホスト PC 視点の観測であり、犯人の真の送信元を保証しません。
- コマンド送信は、前面の Minecraft ウィンドウにキーストロークを送る方式です。
