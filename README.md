# AIRI (personal fork)

This is my personal fork of [Project AIRI](https://github.com/moeru-ai/airi). I am shaping it for one use case: a Live2D character that stays in a corner of the desktop while I game or work. A local or direct-API language model drives the character, and no account is required. I remove upstream features I don't use and build the ones I want.

> [!NOTE]
> This fork is not intended for other users. Features from upstream may be missing or broken here. For the maintained project, releases, and community, use [moeru-ai/airi](https://github.com/moeru-ai/airi).

## How this fork differs from upstream

- **No account.** The clients no longer have sign-in, the official hosted provider, or account pages. Characters, models, and settings stay on your machine. The hosted backend code in `server/` remains in the tree, but the clients do not use it.
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
| Mobile (Stage Pocket, Capacitor) | [`apps/stage-pocket`](./apps/stage-pocket) | Inherited from upstream and not tested in this fork |
| Kirie (Godot desktop host) | [`apps/stage-tamagotchi-kirie`](./apps/stage-tamagotchi-kirie) | Inherited from upstream and still being migrated |

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
| `apps/` | Host apps for desktop, web, mobile, and Kirie |
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
