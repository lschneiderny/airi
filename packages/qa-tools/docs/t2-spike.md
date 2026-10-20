# T2 headless-rig spike

T2 is the test level that runs the real Live2D rig (moc3, Cubism core, and physics) in Node at a fixed timestep, without Electron or a GPU. This spike decides whether T2 is feasible. Todo 14 of the qa-tooling plan reads the verdict.

## Verdict

**GO, path A.** All three criteria hold on the ForBOOTH rig:

| Criterion | Required | Measured | Result |
| --- | --- | --- | --- |
| (a) No GPU, at most a documented minimal global shim | No WebGL; minimal shims | The Node process has no `document` or `WebGLRenderingContext`, and no `window` before the shims. Two one-line shims: `globalThis.__dirname` and `globalThis.window = globalThis` | Pass |
| (b) Max absolute per-parameter difference vs Chromium over 600 frames | <= 1e-5 | 0 in both rounds (168,600 of 168,600 values identical; 281 parameters, 141 of them moving) | Pass |
| (c) Speed: 600 s simulated at 60 Hz in Node, Natural + adapter + physics | >= 10x real time | 55.19x and 56.86x (10.9 s and 10.6 s wall). Earlier runs of the same measurement under parallel-lane CPU load: 24.53x and 44.80x | Pass |

Verdict file: `.omo/evidence/qa-tooling/task-7-verdict.json` = `{ "verdict": "GO", "criteria": { "noGpu": true, "parityMaxAbs": 0, "speedMultiple": 55.19 }, "path": "A" }`.

The verdict is technical only. The license question was settled by Luke's decision recorded in step 1.

**The T2 runner must skip mesh deformation.** With the core's `model.update()` included, the loop runs at 2.6x to 2.8x real time in Node and 3.3x to 4.1x in Chromium, which fails criterion (c). Deformation takes about 90% of the frame. It reads parameters and never writes them: skipping it changed none of the 168,600 recorded values in either round. Criterion (c) names Natural, the adapter, and physics, so the criterion number is measured with deformation skipped. Parity, criterion (b), was measured with the full update on both sides.

Limitation: this spike proves that the rig runs headless and matches Chromium bit for bit. It says nothing about motion quality. T2 scores will prove direction, size relative to the recipe, release, and detectability above the rig's idle noise, not naturalness.

## Step 1: license

The core header (`live2dcubismcore.min.js` lines 2-7) reads: "This file is licensed pursuant to the license agreement below. This file corresponds to the "Redistributable Code" in the agreement." The agreement is the Live2D Proprietary Software License Agreement, version 2.1, revised February 3rd, 2025 (https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html). Clauses about use and redistribution, quoted from the English translation (the Japanese text prevails, Section 15.2):

- 2.1: "Live2D grants the Customer, a limited, non-exclusive, non-sublicensable, and non-transferable license to use the Software for the sole purpose of Publishing the Derivative Work."
- 1.4: "“Derivative Work” means application, animation, or any work developed through using all or any part of the Software."
- 5: "If the Redistributable Code is included in the Software, the Customer may copy and Redistribute the Redistributable Code under the following conditions only to make the Derivative Work and Output File that are produced by using the Software available to the End Users."
- 5.1: "The Customer may copy and distribute the Redistributable Code. In addition, the Customer may allow the Distributors of Derivative Works and Output Files to copy and distribute the Redistributable Code as a part of the Derivative Works and Output Files of the Customer."
- 5.2.4: "Redistribute the Redistributable Code on an as is basis when Live2D provides it, either in Object Code form or in Source Code form."
- 6.1: "Except as expressly permitted in this Agreement, the Customer may not modify, port, adapt, or translate the Software [...]. The Customer may not alter, amend or remove any indication about license included in the Software."
- 6.2: "Except as expressly permitted in this Agreement, the Customer may not distribute or disclose all or part of this Software, or bundle the same with the Derivative Work."
- 3.1: "The Customer may not install the Software on the Compatible Computer of any third party or allow any third party to use the Software."

Decision (Luke, 2026-10-20): running the core in Node for local, non-distributed QA is allowed. The spike evaluates the unmodified core file in place; it does not copy, alter, or distribute it, and nothing from the core or the rig is committed.

## Step 2: load the core in Node

`spikes/t2/core-node.ts` reads the core and evaluates it with `vm.runInThisContext`. No `window` exists. The core takes its Node branch (`process.versions.node`) and uses its built-in asm.js module (it declares `var WebAssembly={}`), so no WebAssembly runtime is involved.

- Without shims, evaluation throws `ReferenceError: __dirname is not defined`: the Node branch evaluates `__dirname + "/"`, and an ES module process has no CommonJS `__dirname` in the global scope. Shim: `globalThis.__dirname = dirname(corePath)`.
- The asm.js module finishes initializing one macrotask after evaluation. Calling `csmGetVersion()` synchronously throws `Cannot read properties of undefined (reading 'apply')`; after one `setImmediate` yield it returns.
- Result: Cubism Core 5.0.0 (`csmGetVersion` = 0x05000000), latest moc version 5.

The core is gitignored (`.gitignore:90`, `**/public/assets/js/*`) and absent from a fresh worktree. The spike reads it from `AIRI_QA_CUBISM_CORE`, defaulting to `apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js`. This run used the main checkout's copy.

## Step 3: load ForBOOTH

The rig layout has one more folder level than the plan assumed: `<AIRI_QA_RIG_FORBOOTH>/ForBOOTH-231-Holder-only@Do-not-share-or-resell/` holds the `.model3.json`, `.moc3` (6,859,584 bytes), `.physics3.json` (58 settings, 165 inputs, 143 outputs), and the `.8192/` texture folder. The model has no pose file, no motions, and an `EyeBlink` group. `spikes/t2/rig.ts` searches two folder levels for the `.model3.json` and fails with a named error when the variable is unset, the folder is missing, or no `.model3.json`/`.moc3` is found. Textures are never read.

## Step 4: path A or path B

**Path A works.** `pixi-live2d-display/cubism4` (dist/cubism4.es.js) imports in Node once `window` exists: its only import-time DOM access is `if (!window.Live2DCubismCore)` at line 5188. Shim: `globalThis.window = globalThis`. Its `@pixi/*` dependencies import without further shims.

`new Cubism4InternalModel(coreModel, settings, {})` needs no GL context. The constructor creates a `CubismRenderer_WebGL`, but `initialize(coreModel)` only builds the clipping manager and the sorted drawable list from the core model. The Node process has no WebGL at all, so the constructor, `initialize`, and 36,000 `update()` calls demonstrably ran without GL. Path B (hand-replicating `update()`) was not needed and was not attempted.

## Step 5: AIRI ordering

`spikes/t2/loop.ts` builds the core model with `CubismMoc.create(moc).createModel()`, the internal model, and `CubismPhysics.create(physics3)`, then configures it as `Model.vue` does with expressions enabled (the default): the SDK expression manager and SDK eye blink are removed and the SDK breath controller is deleted (`disableLive2DSdkBreath`). The rig profile comes from `readLive2DRigProfile(parameters, physics._physicsRig)`. `Live2DNaturalMotionAdapter` replaces `updateFocus` with its composition. The Natural controller's seed is drawn from `createRandomStream(1)`; performance settings are the defaults; attention is Model.vue's idle defaults (Natural driver, energy 0.5, auto blink on, no cursor, no speech).

Each frame at a fixed `dt = 1/60` calls `adapter.frame(now)` and then `internalModel.update()`, which runs the motion manager, `updateFocus` (Natural composition), physics, pose (absent on this rig), and `model.update()`. `NaturalTraceRecorder` samples on `beforeModelUpdate`, like the devtools lab capture. 600 frames gave 300 trace samples and a mean adapter weight of 0.9767.

Not installed: AIRI's final motion-manager plugins (expression, auto blink, light squint, manual control, lip sync, breath control). Todo 14 adds the scenario sink on top of this loop.

## Step 6: parity

`spikes/t2/vitest.browser.config.ts` runs `parity.browser.test.ts` in headless Chromium (HeadlessChrome 151.0.7922.34) through the Playwright provider. The core is served from its own folder as Vite's public directory and loaded with a script tag, like `apps/stage-web/src/test/setup-live2d.browser.ts`. The rig bytes reach the page through a Vitest browser command. The page then runs the same `runT2Loop` with the full update. `spikes/t2/parity.ts` compares every parameter of every frame.

| Comparison | Round 1 max abs | Round 2 max abs |
| --- | --- | --- |
| Chromium vs Node (criterion b) | 0 | 0 |
| Node run 1 vs Node run 2 | 0 | n/a |
| Chromium run 1 vs Chromium run 2 | 0 | n/a |
| Node without deformation vs Node full update | 0 | 0 |
| Negative: Chromium vs Node with physics off on the Node side | 30 | 30 |

Exact equality is expected here: both sides run the same asm.js core and the same JavaScript on V8. The negative run shows the diff fails when it should: physics-driven parameters such as `ParamEyesPupilSizeL` (-30 vs 0 at frame 18) and `ParamEyesLash` differ, and only 94,787 of 168,600 values match.

## Step 7: speed

`node-run.ts speed` times 36,000 frames (600 s at 60 Hz) of the loop with deformation skipped and per-stage timers on, which adds overhead, so the measurement is conservative.

| Run | Loop wall | Speed | Compose | Physics |
| --- | --- | --- | --- | --- |
| Round 1 | 10.87 s | 55.19x | 1.69 s | 8.82 s |
| Round 2 | 10.55 s | 56.86x | 1.64 s | 8.56 s |
| Earlier, under parallel-lane load | 24.46 s / 13.39 s | 24.53x / 44.80x | - | - |

Physics dominates the remaining cost (about 0.24 ms per frame). With deformation: 216.3 s for 600 s simulated (2.77x); a 60 s profile split the frame into compose 0.11 ms, physics 0.45 ms, and deformation 5.8 ms.

## Consequences for todo 14

- Skip `model.update()` in the T2 runner. Parameters stay identical, and the speed goes from about 3x to about 55x.
- Keep both shims, each marked with a `NOTICE` comment: `globalThis.__dirname` before evaluating the core, and `globalThis.window = globalThis` before importing `pixi-live2d-display/cubism4`.
- Resolve `pixi-live2d-display` through `@proj-airi/stage-ui-live2d`, or add it to qa-tools as a catalog dependency.
- Take the core path from an environment variable, because fresh worktrees lack it.
- Wait one macrotask after evaluating the core before calling into it.

## Reproduce

From `packages/qa-tools`, with `AIRI_QA_RIG_FORBOOTH` set and `AIRI_QA_CUBISM_CORE` pointing at a local core:

```sh
tsx spikes/t2/node-run.ts parity --physics on --out ../../.temp/qa/t2-spike/node.json
T2_SPIKE_OUT=../../.temp/qa/t2-spike/browser.json vitest run --config spikes/t2/vitest.browser.config.ts
tsx spikes/t2/parity.ts ../../.temp/qa/t2-spike/browser.json ../../.temp/qa/t2-spike/node.json --out ../../.temp/qa/t2-spike/parity.json
tsx spikes/t2/node-run.ts speed --seconds 600 --deform off
```

The spike files are excluded from the package `tsconfig` and from the Vitest `node` project. Evidence: `.omo/evidence/qa-tooling/task-7-node-run.txt`, `task-7-parity.json`, `task-7-parity-negative.json`, `task-7-speed.json`, `task-7-bad-rig.txt`, and `task-7-verdict.json`.
