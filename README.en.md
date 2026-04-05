# SpamTrace for Minecraft Bedrock

[![日本語 README](https://img.shields.io/badge/README-%E6%97%A5%E6%9C%AC%E8%AA%9E-16a34a?style=for-the-badge)](README.md)

SpamTrace is a toolkit for Minecraft Bedrock local-host worlds. It records suspicious player activity and chat, then gives you a local web dashboard for containment actions and evidence review.

## What is included

- `addon/`: the Behavior Pack
- `dashboard/`: a local web dashboard that reads Content Log

## What it does

- Records joins, spawns, leaves, and suspicious chat
- Tracks players using stable `player.id` data
- Helps with blocking, trusting, quarantine, and emergency sweep actions
- Provides evidence mode for normal player-chat attribution
- Combines Content Log signals with host-PC network observations

## What it cannot do

- Prove the true remote IP of a player in a local Bedrock world
- See through Microsoft relays or NAT
- Provide a real permanent ban system for local-host Bedrock worlds

## Quick start

1. Import `addon/SpamTraceLoggerBP.mcpack`, or sync the pack into your development folder with `addon/sync-addon.cmd`.
2. Open the world once while you are the only player online.
3. Run `npm start` or `start-dashboard.cmd` inside `dashboard/`.
4. Open `http://127.0.0.1:3984` in your browser.

## Admin binding

SpamTrace uses `player.id` as the primary admin identity instead of relying on `/tag`.  
The first player who opens the world alone is stored as the admin owner, and the same `player.id` is recognized automatically later.  
This keeps working even if role-play addons clear tags during gameplay.

## Publishing policy

This repository excludes personal world IDs, local runtime logs, and user-specific account bindings.  
Only the reusable Windows-focused local-host toolkit is published here.

## License

MIT License
