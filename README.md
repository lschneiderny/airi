# AIRI (personal fork)

This is my personal fork of [Project AIRI](https://github.com/moeru-ai/airi). I am shaping it for one use case: trapping a vtuber in the corner of my screen.

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
| Web (Stage Web) | apps/stage-web | Retired on 2026-11-16; see [Support scope](#support-scope) |

## Platform support

Windows and macOS retain their documented desktop capability contract.

On Linux, support depends on the desktop backend. On the tested Plasma 6.8.2
host, KDE had the broadest verified set, including the desktop stage on native
Wayland and XWayland.

## Support scope

The fork targets one platform: the Electron desktop app on Linux, macOS, and Windows. Every workspace project falls into one of three groups.

### Supported

Fork features land here, and bugs here are fixed.

| Path | Status | Meaning |
| --- | --- | --- |
| `apps/stage-tamagotchi` | Supported | The desktop app |
| `engines/stage-tamagotchi-godot` | Supported | The VRM stage |
| `integrations/minecraft` | Supported | The Minecraft bot, module, and situation sensor |
| `plugins/airi-plugin-web-extension` | Supported | Presence browser activity |
| `packages/*` | Supported | Every package not listed in the other tables |
| `scripts/` | Supported | Repository tooling |

### Kept from upstream

The fork does not develop these. It changes them only to keep the workspace building, and upstream syncs bring in upstream's changes.

| Path | Status | Meaning |
| --- | --- | --- |
| `server` | Kept | The hosted backend; the clients do not use it |
| `integrations/discord-bot` | Kept | The Discord bot |
| `integrations/vscode` | Kept | The VS Code integration |
| `plugins/airi-plugin-claude-code` | Kept | The Claude Code plugin |
| `services/computer-use-mcp` | Kept | The computer-use service |
| `apps/component-calling` | Kept | The component-calling demo app |
| `packages/memory-pgvector` | Kept | The pgvector memory package |
| `packages/input-playstation-dualsense-5` | Kept | The DualSense controller input |
| `packages/stage-pages/src/pages/v2` | Kept | The upstream v2 pages |
| `packages/stage-ui/src/stores/modules/home-assistant.ts` | Kept | The in-app Home Assistant module, woven into shared code |
| `packages/stage-ui/src/stores/modules/artistry.ts` | Kept | The in-app Artistry module, woven into shared code |

### Retired

These paths were removed. Upstream changes to them are dropped on sync.

| Path | Status | Meaning |
| --- | --- | --- |
| apps/stage-tamagotchi-kirie | Retired 2026-10-31 | The Godot/CEF desktop host |
| apps/stage-pocket | Retired 2026-11-04 | The native mobile host |
| packages/cap-vite | Retired 2026-11-04 | The Capacitor Vite helper for the mobile host |
| apps/ui-server-auth | Retired 2026-11-04 | The hosted sign-in UI |
| apps/stage-web | Retired 2026-11-16 | The web app |
| packages/model-driver-mediapipe | Retired 2026-11-16 | The MediaPipe model driver |
| integrations/telegram-bot | Retired 2026-11-16 | The Telegram bot |
| integrations/twitter-services | Retired 2026-11-16 | The Twitter services |
| integrations/satori-bot | Retired 2026-11-16 | The Satori bot |
| plugins/airi-plugin-bilibili-laplace | Retired 2026-11-16 | The Bilibili LAPLACE plugin |
| packages/stage-ui/src/components/modules/X.vue | Retired 2026-11-16 | The stage-ui X module (with packages/stage-ui/src/stores/modules/twitter.ts) |

The Retired table is the path list the upstream sync uses to resolve delete-versus-modify conflicts: a retired path stays deleted. The port-back conditions for Kirie and Pocket are in [`docs/ai/context/upstream-watch.md`](./docs/ai/context/upstream-watch.md).

## Getting started

This fork publishes no releases, so you run it from source. You need [Git](https://git-scm.com/downloads) and [mise](https://mise.jdx.dev/installing-mise.html), which installs the Node.js and pnpm versions pinned in [`.tool-versions`](./.tool-versions).

```shell
git clone https://github.com/lschneiderny/airi.git
cd airi
mise install
pnpm install
pnpm dev   # desktop app
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
