# Stage UI Three

## CONVENTIONS
- Keep external frame hooks separate from internal model and material lifecycle hooks.
- Cache operations return evictions for the caller to dispose.
- Keep emote state in `shallowRef` to preserve nested render-loop refs.

## ANTI-PATTERNS
- Emotes must not write blink-owned or animation-owned expressions, even zero values.
- Preserve manual MToon updates during model advancement and one-frame previews.
- Avoid duplicate diffuse IBL injection.
- Copy retained head-anchor values because the source storage is reused.
- Dispose previous environments when switching backgrounds.

## CHECKS
- Node tests only: `pnpm -F @proj-airi/stage-ui-three exec vitest run --project node`.
- Browser tests only: `pnpm -F @proj-airi/stage-ui-three exec vitest run --project browser`. Headless Chromium runs `*.browser.test.ts` with autoplay allowed.
