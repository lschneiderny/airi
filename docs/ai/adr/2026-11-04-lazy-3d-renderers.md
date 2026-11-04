# Lazy 3D renderers on the trunk

Date: 2026-11-04
Status: accepted

## Context

Luke uses the product with Live2D models. MMD support is early and grows when he has time, and VRM is planned as milestone M5 of the [3D character roadmap](2026-10-30-3d-character-motion.md). The 3D work used to live on the long-running branch `luke/feat/fullscreen-stage` so that it could not slow the Live2D product. A branch drifts from `main`, though, and its conflicts grow with every shared change, such as the [interaction portability](2026-11-04-interaction-portability.md) work.

Before this change, the main window imported `MMDScene` and `ThreeScene` statically, and both hosts installed Tres globally. A Live2D stage therefore downloaded and parsed three, three-mmd, three-vrm, and the Tres scene graph at startup.

## Decision

The 3D renderers live on `main` in three tiers:

1. The Live2D companion is the product.
2. Shared, renderer-neutral foundations, such as `motion-driver-natural` and the interaction contract, live on `main` and are tuned on Live2D first.
3. The experimental 3D track (`stage-ui-mmd`, `motion-driver-humanoid`, the desktop stage, locomotion, and clips) also lives on `main`. It loads only when an MMD or VRM model is selected. The parts of the desktop stage that change a Live2D user's windows will sit behind an off-by-default experimental setting when the branch lands. Tier 3 has no QA obligation.

Loading rules:

- `Stage.vue` and `PreviewStage` load `MMDScene` and `ThreeScene` with `defineAsyncComponent`. Hosts do not install Tres; `ThreeScene` brings what it needs.
- Code on the eager path imports only the three-free subpaths: `@proj-airi/stage-ui-mmd/stores`, `stores/*`, `constants/*`, `composables/mmd/overlay-flags`, and `@proj-airi/stage-ui-three/stores/*`, `composables/hit-test`, `assets/*`. Type imports from any path are allowed, because they do not reach the bundle.

Enforcement:

- The ESLint rule `airi/lazy-3d-renderers` in `eslint.config.ts` rejects static value imports of the package roots, of other subpaths, and of three, three-mmd, three-vrm, and Tres, in `stage-ui`, `stage-layouts`, `stage-pages`, and the Electron and web hosts. Tests and devtools pages are exempt. Pocket still installs Tres globally and stays out of scope until its host-scope decision.
- `pnpm check:bundle` builds the Electron app and fails if any chunk the main window loads at startup contains three. It recognizes three by the `__THREE__` property that three sets when it loads, which also covers three-mmd, three-vrm, and Tres because they import three. It needs a build, so it is not part of `pnpm verify`.

## Consequences

The main window JavaScript dropped from 16.78 MB to 13.57 MB in commit `afb1e0155`. `pnpm check:bundle`, which counts only the chunks reached through static imports, measured 110 chunks and 10.63 MB at startup on 2026-11-04. Selecting an MMD or VRM model now waits for one extra chunk download.

The fullscreen-stage branch can land on `main` in pieces, as long as each piece passes the lint rule and the bundle check. The branch is retired after it lands.
