# Live2D Guide

## OVERVIEW

Pixi/Cubism model rendering, natural motion, expressions, archives, and screen lighting. Score: 12. Distinct renderer boundary.
Follow the [root guide](../../AGENTS.md) for shared rules and task skills.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Scene lifecycle | `src/components/scenes/live2d/Model.vue` | Loading, filters, frame updates, teardown |
| Motion plugins | `src/composables/live2d/motion-manager.ts` | Handled state and final plugins |
| Natural motion facade | `src/composables/live2d/natural-motion.ts` | `Live2DNaturalMotion`, fixed 120 Hz grid |
| Natural motion layers | `src/composables/live2d/natural-motion/` | Gaze, blink, body, touch, mood, traces, rig profile |
| SDK integration | `src/composables/live2d/natural-motion-adapter.ts` | Overlay before physics, bracketed by SDK save/load |
| Emotion gates | `src/composables/live2d/natural-motion/emotion-score.ts` | Pure statistical scorer for gate verdicts |
| Emotion recipes | `src/composables/live2d/natural-motion/emotions.ts`, `src/constants/emotions.ts` | Per-emotion tables and motion maps |
| Touch and hit regions | `src/composables/live2d/touch-{regions,debug}.ts` | Visible drawable bounds. The classifier is `NaturalTouchGestures` in `motion-driver-natural`, shared with MMD |
| Head geometry | `src/composables/live2d/head-anchor.ts` | Settled drawable bounds |
| Expression state | `src/stores/expression-store.ts` | Groups and blend modes |
| Screen lighting | `src/filters/screen-ambient-light.ts` | Shared linear-light contracts |
| Model archives | `src/utils/` | ZIP decoding, validation, OPFS cache, preview |
| Trace and benchmark tools | `scripts/` | Run with `node --import tsx` from the package |

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
- Natural-motion tests use seeded streams and fixed frame steps, not wall-clock waits.
- Bump `EmotionGate.version` whenever a threshold, window, or seed rule changes.
- `score-natural-captures.ts` requires `--gate <gate id>` and at least three trace files.

## ANTI-PATTERNS

- Do not retain pooled textures in filter uniforms after release.
- Keep `outputFrame` precision aligned with the vertex shader.
- Destroy cached model textures and renderer resources during replacement or unmount.
- Do not confuse padded canvas bounds with measured character bounds.
- Do not treat `__MACOSX`, `._` entries, or `items_pinned_to_model.json` as model settings.
- Do not read a passing emotion gate as proof of visual naturalness. Visual acceptance still needs rendered review.

## CHECKS

- Typecheck: `pnpm -F @proj-airi/stage-ui-live2d typecheck`.
- Tests: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run`.
- Vitest separates Node tests from headless Chromium `*.browser.test.ts` GPU tests.
- Node tests only: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --config vitest.node.config.ts`.
- Browser tests only, from the repository root: `pnpm test-stage-ui-live2d:run`.
- Natural-motion benchmark: `node --expose-gc --import tsx scripts/bench-natural.ts [--frames 10000] [--runs 5]`.
