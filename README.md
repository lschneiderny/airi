# AIRI (personal fork)

This is my personal fork of [Project AIRI](https://github.com/moeru-ai/airi). I am shaping it for one use case: trapping a vtuber in the corner of my screen. A local or direct-API language model drives the character.

> [!NOTE]
> This fork is not intended for other users. Features from upstream may be missing or broken here. For the maintained project, releases, and community, use [moeru-ai/airi](https://github.com/moeru-ai/airi).

## How this fork differs from upstream

- **Smaller provider catalog.** Settings > Providers lists local and direct-API providers only, such as Ollama, LM Studio, OpenAI, OpenAI-compatible endpoints, OpenRouter, Anthropic, DeepSeek, and OpenCode Go. Speech providers include ElevenLabs, OpenAI-compatible TTS, and local Kokoro.
- **Natural motion driver for Live2D.** This driver is an alternative to the upstream Universal and MAGIC drivers. It generates layered procedural motion for posture, gaze, blinking, breathing, and the face. Performance state, mood, and held emotions drive that motion, so the character still looks inhabited while idle.
- **Expression performance.** Each model's `.exp3.json` files are loaded into a per-model catalog with derived labels and suggested emotion mappings. The language model can use the curated expressions through ACT cues and tools.
- **Touch and cursor attention.** You can poke and pet the model. With the Natural driver, the character's attention follows the cursor.
- **Situational presence.** The desktop character reaches out a few times a day for her own reasons, with long quiet stretches between messages. Settings > Presence controls what foreground information she can see.
- **Development tooling.** The fork adds motion QA gates (`pnpm qa:*`), changed-file verification (`pnpm verify`), worktree helpers (`pnpm wt`, `pnpm dev:top`), and a shared CPU budget for builds and tests (`pnpm slots`).

The design records for these features are in [`docs/ai/adr/`](./docs/ai/adr/).

## Apps

| App | Path | Status in this fork |
| --- | --- | --- |
| Desktop (Stage Tamagotchi, Electron) | [`apps/stage-tamagotchi`](./apps/stage-tamagotchi) | Main target |
| Web (Stage Web) | [`apps/stage-web`](./apps/stage-web) | Works without desktop-only features such as foreground-window sampling |

## Platform support

Windows and macOS retain their documented desktop capability contract; their
post-Electron-bump live smoke is still for Luke to run. On macOS, Electron
issue #54597 means Electron 43.8.7 can launch if sleep/wake notification
registration is refused, but `powerMonitor` suspend and resume events do not
fire in that process. Luke's smoke should verify startup and event delivery
when registration succeeds. If registration is refused, missing suspend and
resume events are expected.

On Linux, support depends on the desktop backend. On the tested Plasma 6.8.2
host, KDE had the broadest verified set, including the desktop stage on native
Wayland and XWayland.
Foreground, cursor, geometry and keep-above passed the KWin native host smoke;
idle becomes live after runtime verification, while lock and system audio
remain unverified in the QA profile. The tested X11 Openbox session verified
foreground, cursor and geometry, and its desktop stage was eligible. Native
X11 push-to-talk key-up uses uiohook. The Xvfb stage smoke needed SwiftShader
because the test display has no GPU. Raw X11 and XWayland stage pointerdown
and rest-timing receipts were not retained; those checks remain pending F3.

Sway verifies geometry but uses the classic window; its headless test session
could not verify foreground or idle. Hyprland has an implemented backend but
has not had a live run, so its runtime support remains unverified. GNOME has
no foreground or global cursor sensor because AIRI does not ship a GNOME Shell
extension. The [host capability contract](./docs/ai/adr/2026-11-08-host-capability-contract.md#host-parity-matrix)
records each signal status and its evidence limits.

## Getting started

This fork publishes no releases, so you run it from source. You need [Git](https://git-scm.com/downloads) and [mise](https://mise.jdx.dev/installing-mise.html), which installs the Node.js and pnpm versions pinned in [`.tool-versions`](./.tool-versions).

```shell
git clone https://github.com/lschneiderny/airi.git
cd airi
mise install
pnpm install
pnpm dev:tamagotchi   # desktop app
pnpm dev              # web app
```

After the app starts, configure a chat provider in Settings > Providers, then choose or import a Live2D model in Settings > Models.

[CONTRIBUTING.md](./.github/CONTRIBUTING.md) covers platform setup, the other apps, and the checks to run before a commit.

## Repository layout

| Directory | Contents |
| --- | --- |
| `apps/` | Host apps for desktop and web |
| `packages/` | Shared UI, chat orchestration, Live2D/VRM/MMD renderers, audio, providers, and i18n |
| `engines/` | Godot rendering sidecar |
| `integrations/` | Discord, Telegram, Minecraft, and VS Code integrations inherited from upstream |
| `plugins/`, `services/` | AIRI plugins and the computer-use service |
| `server/` | Hosted backend inherited from upstream; the clients do not use it |
| `docs/ai/adr/` | Design decisions for this fork |

Each app and package has its own `README.md`. [`AGENTS.md`](./AGENTS.md) records the repository conventions.

## Upstream

`origin` is this fork and `upstream` is `moeru-ai/airi`. The fork has diverged heavily in chat orchestration, the Live2D stack, and the stores. For that reason, upstream changes are brought in as selected cherry-picks instead of merges.

## License and credits

This fork is [MIT](./LICENSE) licensed, like upstream. It is built on [Project AIRI](https://github.com/moeru-ai/airi) by Moeru AI and its contributors.

The Live2D Cubism Core has its own license from Live2D Inc. Live2D models and artwork have their own terms. This repository does not include any models.
