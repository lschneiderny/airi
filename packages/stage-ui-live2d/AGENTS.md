# Live2D Guide

## CONVENTIONS

- Public exports point to source files, not a package build.
- ZIP and OPFS loaders install upstream middleware through import side effects.
- Expression plugins run in the final stage and do not mark a frame handled. AutoEyeBlink runs after expression and multiplies on top of it (`Model.vue` :607-608).
- Final motion plugins run even when earlier plugins handle a frame.
- Expression blends, additive and multiplicative, compose on the value the motion writers left this frame. `restoreExpressionBases` first clears last frame's expression output (`Model.vue` :599, `expression/compose.ts` :106-130, `expression-controller.ts` :85-101).
- Archive readers share filename decoding. Unflagged non-ASCII ZIP names prefer GBK.
- Persist original archive paths and settings. Increment cache version when its directory shape changes.
- `package.json` exports each natural-motion module through the `./composables/live2d/natural-motion/*` wildcard. Keep those modules free of Pixi, Vue files, and `window`, because Node import tests resolve them directly.
- Natural-motion time is monotonic seconds. Each layer receives its own seeded `RandomStream` and never calls `Math.random`.
- `Live2DNaturalMotion` runs on a fixed 120 Hz grid.
- The natural-motion SDK adapter overlays before physics, bracketed by SDK save/load.
- The touch gesture classifier is `NaturalTouchGestures` in `motion-driver-natural`, shared with MMD. Hit regions here use visible drawable bounds.
- Natural-motion tests use seeded streams and fixed frame steps, not wall-clock waits.
- Bump `EmotionGate.version` whenever a threshold, window, or seed rule changes.
- `score-natural-captures.ts` requires `--gate <gate id>` and at least three trace files.
- Run `scripts/` trace and benchmark tools with `node --import tsx` from the package.

## ANTI-PATTERNS

- Do not retain pooled textures in filter uniforms after release.
- Keep `outputFrame` precision aligned with the vertex shader.
- Destroy cached model textures and renderer resources during replacement or unmount.
- Do not confuse padded canvas bounds with measured character bounds.
- Do not treat `__MACOSX`, `._` entries, or `items_pinned_to_model.json` as model settings.
- Do not read a passing emotion gate as proof of visual naturalness. Visual acceptance still needs rendered review.

## CHECKS

- Vitest separates Node tests from headless Chromium `*.browser.test.ts` GPU tests.
- Node tests only: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --config vitest.node.config.ts`.
- Browser tests only, from the repository root: `pnpm test-stage-ui-live2d:run`.
- Natural-motion benchmark: `node --expose-gc --import tsx scripts/bench-natural.ts [--frames 10000] [--runs 5]`.
