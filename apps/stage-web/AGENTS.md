# STAGE WEB KNOWLEDGE BASE

## CONVENTIONS
- Parent guidance: [root AGENTS.md](../../AGENTS.md). Its task-routing skills also apply here.
- Vite aliases shared packages to their source directories.
- Routes exclude component folders and selected shared authentication, account, and provider pages.
- Hugging Face builds use hash history. Other browser builds use web history.
- Vite downloads sample assets into stage-ui assets and uses the repository `.cache` directory.
- Sherpaw downloads only the selected remote model.
- Analytics chunks use neutral `auxiliary-[hash].js` names.
- Unsupported performance metrics remain disabled.

## COMMANDS
From the repository root, `pnpm dev:web` wraps development and `pnpm test-stage-web:run` runs only the browser project.

## ANTI-PATTERNS
- Do not remove the PWA plugin in development. `virtual:pwa-register` requires it.
- Do not assume that disabled service-worker generation removes an older worker from the origin.
- Do not precache WASM variants. The runtime cache loads them on demand.
- Keep `/docs/`, `/ui/`, `/remote-assets/`, and `/api/` outside the service-worker navigation fallback.
- Do not equate browser build success with Live2D or VRM rendering acceptance.
