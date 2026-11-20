# Live2D Guide

## CONVENTIONS

- ZIP and OPFS loaders install upstream middleware through import side effects.
- Archive readers share filename decoding. Unflagged non-ASCII ZIP names prefer GBK.
- Persist original archive paths and settings. Increment cache version when its directory shape changes.
- `package.json` exports each natural-motion module through the `./composables/live2d/natural-motion/*` wildcard. Keep those modules free of Pixi, Vue files, and `window`, because Node import tests resolve them directly.
- Natural-motion time is monotonic seconds. Each drawing layer receives its own seeded `RandomStream`, an idle act draws its shape from its order's `seed`, the cursor layer plays the episodes the character mind draws, and nothing calls `Math.random`.
- Upstream's touch module runs, and its beat sync plugins write, under the Universal and MAGIC drivers only, as upstream ships them. A touch there never reaches the character mind. Under Natural, beat sync stays `silent` (`beatSyncMode`), and nothing but Natural writes head angles.
- Under Natural, the scene only classifies a touch and reports it (`naturalTouch`, a `TouchReport`). It shows a poke or a pet only when the stage calls `reactToTouch` with the character mind's `touch-reaction` intent, and the pet hand reaches Natural only while the mind's pet is granted. Never start a touch response from the classifier.
- The touch gesture classifier is `NaturalTouchGestures` in `motion-driver-natural`, shared with MMD. Hit regions here use visible drawable bounds.
- Natural-motion tests use seeded streams and fixed frame steps, not wall-clock waits.
- `natural-motion/observer.test.ts` pins golden hashes of Natural frames. Compute them with Vitest under Node, never Bun, whose Math differs in the last bits. Re-pin once per intended motion change, with the reason in the commit message. Confirmation of the pins on macOS is pending.
- `natural-motion/liveliness-gate.test.ts` scores idle liveliness against `reference-stats.ts`; desk recordings are valid for idle liveliness only.
- Run `scripts/` trace and benchmark tools with `node --import tsx` from the package.

## ANTI-PATTERNS

- Do not retain pooled textures in filter uniforms after release.
- Keep `outputFrame` precision aligned with the vertex shader.
- Destroy cached model textures and renderer resources during replacement or unmount.
- Do not confuse padded canvas bounds with measured character bounds.
- Do not treat `__MACOSX`, `._` entries, or `items_pinned_to_model.json` as model settings.

## CHECKS

- Natural-motion benchmark: `node --expose-gc --import tsx scripts/bench-natural.ts [--frames 10000] [--runs 5]`.
