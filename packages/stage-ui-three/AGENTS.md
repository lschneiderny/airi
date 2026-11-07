# Stage UI Three

## OVERVIEW
Three scene coordination, VRM lifecycle, and renderer diagnostics. Score: 12. Distinct renderer boundary with source exports and explicit resource ownership.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Scene readiness and binding | `src/components/ThreeScene.vue` |
| Model load, commit, cleanup | `src/components/Model/VRMModel.vue` |
| Detached instance ownership | `src/components/Model/vrm-instance-cache.ts` |
| VRM expressions, animation, outlines | `src/composables/vrm/` |
| Shader and environment helpers | `src/composables/shader/` |
| Camera and scene state | `src/stores/` |
| Trace contracts and snapshots | `src/trace/` |
| Isolated preview rendering | `src/utils/vrm-preview.ts` |
| Public subpaths | `package.json` exports `.`, `./components/ThreeScene.vue`, `./composables/hit-test`, `./composables/vrm`, `./stores/model-store`, `./stores/view-control`, `./trace`, `./utils/vrm-preview`, `./assets/vrm`. The root re-exports `ThreeScene`, so code on a Live2D path imports the store and hit-test subpaths and loads `ThreeScene.vue` with a dynamic import. |

## CONVENTIONS
- The caller supplies the audio context and current source. Do not import the Stage audio store.
- Scene binding requires both a committed model and initialized controls.
- Keep external frame hooks separate from internal model and material lifecycle hooks.
- Cache ownership uses both `scopeKey` and `modelSrc`.
- Cache operations return evictions for the caller to dispose.
- Model switches preserve the camera offset relative to the model origin.
- Keep emote state in `shallowRef` to preserve nested render-loop refs.
- Follow root routing for rendering tests, design, TypeScript, UnoCSS, and store changes.

## ANTI-PATTERNS
- Do not share detached VRM instances across apps or windows.
- Do not use trace as a business bus, non-Three telemetry bus, or renderer-to-main control channel.
- Emotes must not write blink-owned or animation-owned expressions, even zero values.
- Preserve manual MToon updates during model advancement and one-frame previews.
- Avoid duplicate diffuse IBL injection.
- Copy retained head-anchor values because the source storage is reused.
- Dispose previous environments when switching backgrounds.

## CHECKS
- `pnpm -F @proj-airi/stage-ui-three typecheck`
- `pnpm -F @proj-airi/stage-ui-three exec vitest run`
- Node tests only: `pnpm -F @proj-airi/stage-ui-three exec vitest run --config vitest.node.config.ts`.
- Browser tests only, from the repository root: `pnpm test-stage-ui-three:run`. Headless Chromium runs `*.browser.test.ts` with autoplay allowed.
- This package exports source and has no build script.
