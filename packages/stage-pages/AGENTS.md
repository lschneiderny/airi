# Stage Pages

## CONVENTIONS
- Stage applications scan these pages through their Vite router configuration.
- The root `src/index.ts` only emits a warning. Import route files through wildcard subpaths, such as `@proj-airi/stage-pages/pages/devtools/polaroid.vue`.
- Keep application-specific routes in their application.
- Put reusable business components in stage-ui, primitives in ui, and layouts in stage-layouts.
- The V2 provider editor does not replace active `/settings/providers` routes.
- Browser tests use real Pinia, router and i18n setup with `virtual:uno.css`.

## ANTI-PATTERNS
- Do not request microphone permission when a hearing page opens. Acquire it when monitoring starts.
- Provider previews must not commit runtime provider selections.
- Clear card history when another card opens.
- Use the API server origin for account password-reset redirects. Electron pages can use `file://`.
- Ignore account-operation results after account identity changes.
- Report billing analytics as buckets, not exact balances.
- Keep the `// NOTICE:` native `confirm` guard in `src/pages/settings/scene/index.vue` until a shared modal confirmation component is wired into that flow.

## CHECKS
- Browser tests live under `src/**/*.browser.test.ts` and require Chromium.
