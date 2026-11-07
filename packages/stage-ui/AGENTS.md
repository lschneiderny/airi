# Stage UI Guidance

## OVERVIEW

Shared stage business UI and runtime adapters. Score: 15, a distinct package boundary with 48 source exports, dedicated test configuration, and widely referenced stores.
Follow the [root guide](../../AGENTS.md) and its task-routing skills before changing code.

## WHERE TO LOOK

Paths below are relative to this package.

| Task | Location |
| --- | --- |
| Package exports and scripts | `package.json` |
| Chat requests, retries, tool authorization | `src/stores/chat.ts`, `src/stores/ai/chat-llm/` |
| Sessions, persistence, account transitions | `src/stores/chat/`, `src/database/repos/`, `src/libs/chat-sync/` |
| Composer, history, replies, voice controls | `src/components/scenarios/chat/` |
| Provider definitions and runtime registration | `src/libs/providers/providers/` |
| Provider records, instances, discovery | `src/stores/providers/config.ts`, `src/stores/providers/provider.ts` |
| Character defaults and module inheritance | `src/stores/modules/airi-card.ts`, `src/services/airi-card-modules.ts` |
| Voice host and Eventa contracts | `src/stores/voice.ts`, `src/services/speech/bus.ts` |
| Capture, VAD, wake words, synthesis | `src/composables/audio/`, `src/libs/audio/`, `src/libs/voice/`, `src/libs/speech/` |
| Model loading, GPU bookkeeping, workers | `src/libs/inference/`, `src/workers/` |
| Model settings and renderer capture | `src/components/scenarios/settings/model-settings/`, `src/components/scenes/Stage.vue` |
| Synced store setup and leadership | `src/libs/pinia/setup-synced.ts`, `src/stores/situation/` |
| Mod channel and context bridge | `src/stores/mods/api/context-bridge.ts` |
| MCP and web-search tools | `src/tools/`, `src/stores/mcp-tool-bridge.ts` |
| Long-term memory | `src/stores/memory.ts`, `src/tools/memory.ts`, `src/database/repos/memory.repo.ts` |
| Live2D motion runtime and workbench | `src/features/motions/live2d/`, `src/features/devtools/motion/live2d/` |
| Small-document synchronization | `src/libs/document-sync/README.md`, `src/libs/character-card-sync/` |
| Home Assistant access policy and tools | `src/libs/home-assistant/`, `src/tools/home-assistant.ts` |
| Product events and tracing | `src/libs/product-signals/`, `src/composables/use-analytics.ts`, `src/composables/use-io-tracer.ts` |

## CONVENTIONS

- This fork uses local data and direct or local inference providers. Read the account-free policy in `README.md`.
- Hosted adapters remain for saved-provider cleanup. Their presence does not make hosted services available in clients.
- Package exports target TypeScript source. `build` only prints a message and does not validate or bundle the package.
- Put component stories beside their components. Put independent stories in `stories/`.
- `vitest.config.ts` separates serial Node tests from headless Chromium browser tests.
- Browser tests scan product UnoCSS sources before the initial stylesheet. Preserve this configuration when changing test setup.
- For synced stores, read the root `enforce-rules-for-pinia-synced` skill. Install both plugins returned by `setupSynced`.
- Keep provider records serializable. Executable instances, request epochs, and tool executors stay local to their runtime.
- Synced stores disable storage-event replication when Pinia owns propagation.
- One audio host owns capture and playback. Other windows issue commands and render snapshots.
- `src/stores/chat.ts` is the integration hub where chat meets presence, unprompted turns, and memory. It may gain wiring lines only. A new system, such as touch observations, lives in its own module and talks to chat through chat store actions or the hooks and controls the store hands out (`useSituationStore().observeChat` is the pattern).
- Read the document-sync README before changing callers. Its design record is `server/docs/ai/adr/2026-10-06-document-sync.md`.

## COMMANDS

Run from the repository root. Select the project that matches the test file.

```sh
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-ui exec vitest run --project node src/libs/document-sync/reconcile.test.ts
pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/chat/components/history.browser.test.ts
pnpm -F @proj-airi/stage-ui test:run
pnpm -F @proj-airi/stage-ui run story:dev
pnpm -F @proj-airi/stage-ui run story:build
```

## ANTI-PATTERNS

- Preserve the public `@proj-airi/stage-ui/stores` forwarding barrel. Prefer explicit subpaths for new consumers.
- Do not infer provider availability from an adapter file. Check registration and catalog filtering.
- Do not save cards from settings watchers or invoke activation commands when applying replicated snapshots.
- Never copy a previous card's overrides into global defaults. Models inherit only within the same provider.
- Keep selected sessions local to each window. Queued turns retain their session character.
- Never replay a whole model turn after tool execution starts. Request-only tools require current explicit selections.
- Keep durable image/audio history intact when projecting provider requests. Tool reruns also require the tool-image reader.
- Do not open microphones while rendering controls. Unsupported push-to-talk stays off rather than enabling continuous capture.
- Do not let stale catalog requests, account work, or transcription generations overwrite newer state.
- Do not treat WebSocket closure as completed synthesis without `session.finished`.
- Document-sync accepts small JSON documents, not secrets, files, or large chat histories. Omit removed fields instead of `null`.
- Write `applyLocal` changes before awaiting. Serialize synchronization per feature/account and retain refused documents' sync state.
- Preserve unowned character-card extension fields. Unknown sticker IDs remain placeholders, never image URLs.
- Home Assistant calls name exactly one entity target. Service data must not carry another target key.
- Keep MCP call-tool arguments as a JSON string until schema conversion emits an object schema OpenAI accepts.
