# Stage Pages

## OVERVIEW
Shared route-level Vue pages for stage applications. Score: 8, with a source export boundary and shared route ownership.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Shared routes | `src/pages/` |
| Provider catalog and active editor | `src/pages/settings/providers/` |
| Separate V2 provider editor | `src/pages/v2/settings/providers/` |
| Character card editing and history | `src/pages/settings/airi-card/` |
| Hearing overview, transcription, wake words | `src/pages/settings/modules/hearing/` |
| Account deletion and authentication | `src/pages/settings/account/` |
| Runtime diagnostics | `src/pages/devtools/context-flow/`, `src/pages/devtools/io-tracer/` |
| Speech and transcription settings | `src/pages/settings/modules/speech.vue`, `src/pages/settings/modules/hearing/transcriber.vue` |

## CONVENTIONS
- Stage applications scan these pages through their Vite router configuration.
- The root `src/index.ts` only emits a warning. Import route files through wildcard subpaths, such as `@proj-airi/stage-pages/pages/devtools/polaroid.vue`.
- Keep application-specific routes in their application.
- Put reusable business components in stage-ui, primitives in ui, and layouts in stage-layouts.
- The V2 provider editor does not replace active `/settings/providers` routes.
- Browser tests use real Pinia, router and i18n setup with `virtual:uno.css`.
- Follow the root task routing for design, TypeScript, UnoCSS, tests, and translations.

## ANTI-PATTERNS
- Do not request microphone permission when a hearing page opens. Acquire it when monitoring starts.
- Provider previews must not commit runtime provider selections.
- Clear card history when another card opens.
- Use the API server origin for account password-reset redirects. Electron pages can use `file://`.
- Ignore account-operation results after account identity changes.
- Report billing analytics as buckets, not exact balances.
- Keep the `// NOTICE:` native `confirm` guard in `src/pages/settings/scene/index.vue` until a shared modal confirmation component is wired into that flow.

## CHECKS
- `pnpm -F @proj-airi/stage-pages typecheck`
- `pnpm -F @proj-airi/stage-pages test:run`
- Browser tests live under `src/**/*.browser.test.ts` and require Chromium.
