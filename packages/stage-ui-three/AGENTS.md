# Stage UI Three

## CONVENTIONS
- The root re-exports `ThreeScene`, so code on a Live2D path imports the store and hit-test subpaths and loads `ThreeScene.vue` with a dynamic import.
- The caller supplies the audio context and current source. Do not import the Stage audio store.
- Scene binding requires both a committed model and initialized controls.
- Keep external frame hooks separate from internal model and material lifecycle hooks.
- Cache ownership uses both `scopeKey` and `modelSrc`.
- Cache operations return evictions for the caller to dispose.
- Model switches preserve the camera offset relative to the model origin.
- Keep emote state in `shallowRef` to preserve nested render-loop refs.

## ANTI-PATTERNS
- Do not share detached VRM instances across apps or windows.
- Do not use trace as a business bus, non-Three telemetry bus, or renderer-to-main control channel.
- Emotes must not write blink-owned or animation-owned expressions, even zero values.
- Preserve manual MToon updates during model advancement and one-frame previews.
- Avoid duplicate diffuse IBL injection.
- Copy retained head-anchor values because the source storage is reused.
- Dispose previous environments when switching backgrounds.

## CHECKS
- Node tests only: `pnpm -F @proj-airi/stage-ui-three exec vitest run --config vitest.node.config.ts`.
- Browser tests only, from the repository root: `pnpm test-stage-ui-three:run`. Headless Chromium runs `*.browser.test.ts` with autoplay allowed.
- This package exports source and has no build script.
