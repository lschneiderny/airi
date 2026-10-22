# AIRI Plugin - Web Extension

> Read what you are reading!

This is a plugin for the AIRI to understand what you are reading, looking at, or listening to on the web.

## What it does now

- Captures page + video context from YouTube and Bilibili.
- Extracts subtitles from text tracks or DOM overlays.
- Sends context updates and optional `spark:notify` events to the character.
- Exposes a popup to configure WebSocket, toggles, and quick status.

## Quick start

1. `pnpm -F @proj-airi/airi-plugin-web-extension dev`
2. Load the unpacked extension from `.wxt/dev` in your browser.
3. Open the popup to set the WebSocket URL (default: `ws://localhost:6121/ws`).
4. Watch a YouTube/Bilibili video and confirm the popup shows the detected title/subtitle.

## What it shares

The content script runs on every page. With the default settings, the extension sends these to the stage:

- the page title and full link;
- the video title, channel, progress, and link;
- subtitle lines;
- one notification for each new video.

The stage adds them to the character's situation, which goes to the chat provider with every request. That provider can be a cloud service.

- **Turn off parts in the popup.** The **Capture Controls** in the popup turn off each kind.
- **Turn it all off in AIRI.** In the desktop app, turn off **Share browser activity** in **Settings > Presence**. AIRI then ignores everything the extension sends, whatever the popup says, and forgets what it already sent.
- **The foreground switch does not cover it.** **Share the foreground app and window titles** is a separate switch.

## When to use it

Use it when the character should know what you read or watch in the browser.

Do not use it on pages whose title or link must stay private, unless browser sharing is off. AIRI applies no denylist to the extension.
