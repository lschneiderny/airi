# STAGE WEB KNOWLEDGE BASE

## OVERVIEW
Browser Stage application with shared AIRI pages and model runtimes. Score: 12, distinct browser deployment boundary.

Parent guidance: [root AGENTS.md](../../AGENTS.md). Its task-routing skills also apply here.

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| Browser bootstrap | `src/main.ts`, `src/App.vue` | Router, synchronized Pinia, startup resources, authentication leadership |
| Stage viewport | `src/pages/index.vue` | Safari Visual Viewport compensation |
| Route discovery | `vite.config.ts` | Local pages plus shared stage-pages, with explicit exclusions |
| Settings navigation | `../../packages/stage-layouts/src/layouts/settings.vue` | Shared browser settings shell |
| Service worker | `src/modules/pwa.ts`, `src/stores/pwa.ts` | Registration and update prompts |
| Performance data | `src/stores/devtools-lag.ts`, `src/composables/perf/` | Supported metrics and recordings |
| Voice activity | `src/workers/vad/` | AudioWorklet and serialized inference |
| Browser coverage | `vitest.config.ts`, `src/test/` | Separate jsdom and Chromium projects |

## CONVENTIONS
- Vite aliases shared packages to their source directories.
- Routes exclude component folders and selected shared authentication, account, and provider pages.
- Hugging Face builds use hash history. Other browser builds use web history.
- Vite downloads sample assets into stage-ui assets and uses the repository `.cache` directory.
- Sherpaw downloads only the selected remote model.
- Analytics chunks use neutral `auxiliary-[hash].js` names.
- Unsupported performance metrics remain disabled.

## COMMANDS
```sh
pnpm -F @proj-airi/stage-web dev
pnpm -F @proj-airi/stage-web dev:https
pnpm -F @proj-airi/stage-web typecheck
pnpm -F @proj-airi/stage-web test:run
pnpm -F @proj-airi/stage-web build
```
From the repository root, `pnpm dev:web` wraps development and `pnpm test-stage-web:run` runs only the browser project.

## ANTI-PATTERNS
- Do not remove the PWA plugin in development. `virtual:pwa-register` requires it.
- Do not assume that disabled service-worker generation removes an older worker from the origin.
- Do not precache WASM variants. The runtime cache loads them on demand.
- Keep `/docs/`, `/ui/`, `/remote-assets/`, and `/api/` outside the service-worker navigation fallback.
- Do not equate browser build success with Live2D or VRM rendering acceptance.
