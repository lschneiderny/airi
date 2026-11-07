# Headless 3D motion feasibility spike

Date: 2026-11-07

Scope: goal G5 of the agent QA tooling run, against `origin/main` at
`8f24621f8`, in `/mnt/dev/projects/dtuber-wt/aqa-g5-3d`.

## Verdict

MMD motion can step in Node without WebGL: a real PMX mesh, the humanoid
director, production body stages, three-mmd IK and grants, and Ammo physics
completed two deterministic 600-frame runs. A T2-3D runner is feasible, but
this dense model ran slightly slower than real time, so the spike establishes
a GPU-free path rather than a fast motion suite.

There is one correction to the question's premise. The installed
`@moeru/three-mmd-physics-ammo@0.2.0-beta.2` bundles the JavaScript build of
`ammojs-typed@1.0.6`. Its bundle contains no `WebAssembly` invocation, and the
installed ammojs-typed package has `ammo/ammo.js` but no `.wasm` asset.
`initAmmo()` exposes no backend argument. The measured result covers the
shipped Ammo backend; it does not establish WASM performance or parity.
Replacing that backend would be a separate dependency investigation.

No product code, dependency manifest, or lockfile changed. No Electron or
browser window was launched. The spike script and all generated evidence
remain untracked outside the worktree.

## Model and execution

The search covered `/home/luke` and `/mnt/dev` for `.pmx` and `.vmd` files,
excluding `node_modules`. It found personal PMX assets and no VMD files.
No PMX fixture was available in the repository. The model used was Chisa:

```text
/mnt/dev/quarantine/personal/vtuber/random-models/MMD/WuWa_Chisa_v1.03/鸣潮_千咲1.02.pmx
```

The model stayed at that path. Its SHA-256 is
`bd2ef352f2c85a9ee26b0d343532cddb72f25b21880b7b7c7095a823b00dbad7`.
It has 65,156 vertices, 1,117 bones, 922 rigid bodies, 1,428 joints, and four
IK chains. These counts matter when choosing a future smoke fixture.

The environment was Linux x64 on a Ryzen 7 5800X3D, with Node `v26.11.1`,
Three `0.185.1`, and three-mmd and its Ammo adapter `0.2.0-beta.2`.
The worktree's existing `tsx` executed the script. A `createRequire` rooted
at the worktree's stage-ui-mmd package resolved the installed libraries;
absolute source imports selected the worktree's production TypeScript.

The script read the PMX bytes and supplied a data URL to
`MMDLoader.loadAsync`. This uses the library's PMX parser, coordinate
conversion, geometry builder, material builder, bone builder, and
`SkinnedMesh` assembly. It then called `initAmmo()` and
`mmd.setPhysics(MMDAmmoPhysics)`.

The loop used the actual `MMDFramePipeline`, `readMMDRigProfile`, and
`MMDBody`, with `decideBody` called once per frame using explicit time and
seed 42. The first 120 frames were idle. At frame 120, the director received
a debug walk goal four leg lengths away, and the mixer began a two-second
procedural wrist rotation clip. The loop advanced exactly 600 times at
`1 / 60` seconds. The production pipeline restored and captured clean
poses, ran body stages, solved IK and grants, updated physics, and measured
feet and arms after physics. Mixer loop events retained the production
physics-reset behavior.

This was a constant neutral Natural frame, with seeded body weight shift,
foot contact, gaze and arm rest. It did not run the Natural controller,
the scene's action bridge, the stance director, or the layered animation
manager. The procedural wrist clip was ordinary mixer playback, not a
director-mediated action. This keeps the result a runtime feasibility
probe rather than acceptance of the clip-action integration.

Each frame recorded both ankle positions, both wrist positions, the hip
position, and a physics-owned hair bone position in world coordinates.
All recorded positions were finite. The final root X was
`38.84193986351697` model units. Both foot IK chains remained enabled and
the installed physics service reported `affectsIK: true`.

## Blockers and the working boundary

An unstubbed texture load failed with this stack, preserved in
`raw-loader.txt`:

```text
ReferenceError: document is not defined
    at createElementNS (.../three/build/three.core.js:1851:2)
    at ImageLoader.load (.../three/build/three.core.js:45175:17)
    at TextureLoader.load (.../three/build/three.core.js:45576:10)
    at loadTextureResource (.../three-mmd/dist/index.js:2209:25)
    at MMDLoader.assembleMMD (.../three-mmd/dist/index.js:3170:65)
```

This requirement belongs to texture loading, not the skeleton or solver.
A catch-all `LoadingManager` texture handler returned inert Three
textures for 23 texture requests. It deliberately did not call image
completion callbacks. Those callbacks otherwise rotate toon images through
`document.createElement('canvas')` and inspect texture alpha. Consequently,
the spike neither loads images nor claims material-loading completion.
It needs no canvas, DOM implementation, or WebGL context.

The script also supplied a minimal `ProgressEvent` class when Node lacked
one, for Three's streamed `FileLoader` progress notifications. This is a
transport shim, separate from the texture handler. A permanent runner
should own this filesystem/image boundary explicitly and record which
visual work it omits.

`pnpm qa:doctor` exited 1 because the fresh worktree lacks both apps'
Live2D Cubism Core downloads; its built-package and dependency checks
passed. Cubism is not imported by this MMD loop. The spike proceeded
without starting apps to download an unrelated runtime.

## Measurements and gate compatibility

Initialization below covers PMX loading and Ammo setup. Loop wall time
covers the director, pipeline, world-position sampling and diagnostic
collection; it excludes JSON serialization and gate evaluation.
There was no warm-up interval.

| Measurement | Run 1 | Run 2 |
| --- | ---: | ---: |
| Frames / simulated seconds | 600 / 10 | 600 / 10 |
| Initialization | 1,174.33 ms | 1,101.22 ms |
| Loop wall time | 11,211.77 ms | 11,030.06 ms |
| Wall time per simulated second | 1,121.18 ms | 1,103.01 ms |
| Speed relative to real time | 0.892x | 0.907x |
| Whole sampled frame p95 | 29.03 ms | 28.76 ms |
| Initial load average, 1 / 5 / 15 minutes | 4.17 / 2.77 / 2.04 | 2.87 / 2.62 / 2.02 |

These are workstation observations under the recorded load, not a
quiet-machine benchmark or the desktop frame-budget gate's AIRI-only
stage timing. This spike did not isolate which stages dominate the cost.

Both runs produced 120 idle, 91 turning, 59 starting, 207 walking, and
123 stopping frames. Each JSON sample file is 258,240 bytes, including
its final newline. `cmp` exited 0: the entire files are byte-identical,
including bone coordinates and arm series. Their file SHA-256 is
`b2559bd20ee7c5e6d67f300638175b2caa6391f0f941ce0e9e2cd9b8a25dfe9c`.
The summaries hash the JSON string before the newline and therefore
report the different digest
`c801e23fcf757cfc2de338579f12a39a59a6ed68245b497ad67c14971df5245a`.
Timing and load data are outside the deterministic series.

The samples were passed directly through `readStageEvidence` and
`runStageGates` from `packages/qa-tools/src/stage/gates.ts`:

- `stage-walk-skate` passed in both runs. Over 480 non-idle frames,
  maximum skate was `0.00002952644328233374` and maximum foot target
  error was `0.0006894203809309765`, both below `0.05`.
- `stage-arm-penetration` failed its duration check. Both penetration
  maxima were zero, but the sample timestamps span only 9.983 seconds,
  below the required 30 seconds. The run also includes walking and is
  not a standing acceptance scenario.
- `stage-frame-budget`, `stage-gesture-walk`, and
  `stage-action-preempt` returned `NO INPUT`. No desktop/window timing
  pairs, qualified layered gesture, or full-action pre-emption was
  supplied.

The loop simulates 10 seconds; labels run from zero to 9,983.333 ms
because the first sample is taken after the first step and labeled zero.
The raw series uses `perFrameSeries.columns` and `rows`, with
`mode`, `skate`, and `feetMaxError` in the format the walk reader already
accepts. Extra columns hold time and bone XYZ values. The arm reader
consumes the separate `perFrame.t_ms`, `penL`, and `penR` arrays.
No gate threshold or input reader was changed.

## Proposed T2-3D shape

A future runner should live under `packages/qa-tools/src/t2-3d/`, with
an MMD loader boundary and runner, following the existing T2 evidence
lifecycle. It should accept an external model path, optional VMD paths,
a scenario, seed, fixed time step, warm-up and scored duration. Record
asset hashes, source revision, dependency versions, solver flags,
clock policy and omitted image work. Product packages must continue
to have no dependency on qa-tools.

Reuse the production pipeline and body adapter. For stance and action
scenarios, compose `MMDStanceDirector` and the production animation
manager as the scene does, including clean commands, clip ownership,
layer feedback and physics resets. Avoid a second implementation of
the pose math. A future implementation must explicitly declare the
qa-tools dependencies needed to import these boundaries; this spike
made no dependency changes.

Feed the existing stage gate readers with measured diagnostics:

| Scenario | Output and gate |
| --- | --- |
| Walk, turn, stop | `perFrameSeries` with actual post-solver skate and foot error, for `stage-walk-skate`. |
| Stand for at least 30 seconds | Arm `perFrame` arrays, for `stage-arm-penetration`. |
| Upper clip over walking | `kind: 'stage-scenario'`, scenario `gesture-walk`, and the exact `stageScenarioColumns`, with at least 10 seconds of qualified walking. |
| Full clip pre-empts a pending goal | The action-preempt scenario columns from actual director and playback feedback, plus separately identified AIRI stage timings. |

Headless timings must not masquerade as rendered frame-budget input.
`stage-frame-budget` needs three real desktop/window pairs, FPS and
hit-test readback, so it remains a rendered check. The action-preempt
gate's timing interpretation also needs an explicit decision before
headless results count as acceptance.

The first regression scenario should reproduce the sit fade implicated
by `3a0baf712`: load a real sit clip, apply its stance ownership and
crossfade, and record ankle target error, planted-foot displacement,
knee rotation and per-frame ankle height change through the transition.
This spike had no local VMD and did not reproduce that bug. Bone data
can expose a foot trajectory discontinuity, but passing this walk
cannot establish that the sitting surface is correct.

T2-3D cannot prove GPU skinning or SDEF artifacts, vertex and material
morph appearance, texture alpha, hair/cloth silhouettes, camera framing,
floor appearance, occlusion, window integration, or perceived motion
quality. It builds a skinned mesh but does not evaluate rendered vertex
deformation. Same-host byte equality does not establish browser parity
or determinism across CPUs, Node versions, or Ammo builds. Rendered
checks and Luke's visual review remain necessary.

Scores prove direction, size relative to the recipe, release, and
detectability above the rig's idle noise. They do not prove naturalness,
which stays a visual review. This spike ran geometric stage checks,
not those Natural statistical scorers.

## VRM and Godot

VRM has no equivalent qa-tools motion tier. Its cheapest first step is
a separate Node load-and-step spike using the existing VRM loader with
image loading isolated, then the subsystem order in
`packages/stage-ui-three/src/components/Model/VRMModel.vue`: mixer and
hooks, humanoid, look-at, expressions, constraints, and spring bones.
Record normalized humanoid bone transforms and spring-bone positions at
a fixed step. Existing VRM unit/browser tests and runtime traces do not
establish this path; this spike did not run it. The roadmap's humanoid
VRM adapter remains future work.

The Godot sidecar likewise has no qa-tools motion tier, although it
already has C# checks and verification scenes. Its cheapest first step
is a bounded `--headless` verification scene driven by explicit frame
count, using the existing VRM import/runtime boundary, logging bone
transforms and exiting without Electron. A mock of the existing host
transport could subsequently check ready/load/dispose behavior.
`StageRoot._Process` polls the bridge and processes view state, so a
standalone scene must supply or deliberately bypass that host setup.
This is a proposal, not measured feasibility, and it cannot replace
the engine's required visible-window visual acceptance.

## Open questions

1. Which redistributable PMX and stance/gesture clips should a permanent
   smoke suite use? Personal Chisa assets must remain external.
2. Can a small real rig retain IK and cloth coverage while substantially
   reducing the measured loop cost? Which production stages dominate?
3. What tolerances establish Node/browser parity, particularly for
   physics-owned bones, before T2-3D can close acceptance rows?
4. Should a WASM backend ever replace the installed JavaScript backend,
   and how would it be injected through the supported adapter API?
5. Which stance transition observables catch the sit foot pop reliably,
   and which still require rendered skinning evidence?
6. How should headless action-preempt CPU timing be reported without
   implying desktop frame-budget acceptance?

## Evidence and reproduction

All evidence is under this untracked directory:

```text
/mnt/dev/projects/dtuber/.omo/evidence/agent-qa-tooling/g5/
```

It contains `spike.mjs`, `raw-loader.txt`, `spike-run-1.txt`,
`spike-run-2.txt`, `series-1.json`, `series-2.json`,
`summary-1.json`, `summary-2.json`, `determinism.txt`, and `checks.txt`.
The two successful spike commands exited 0; the raw loader exited 1.
The gate failures and missing inputs above are findings, not suppressed
failures.

From the worktree, reproduce each successful capture with:

```bash
pnpm -F @proj-airi/qa-tools exec tsx \
  /mnt/dev/projects/dtuber/.omo/evidence/agent-qa-tooling/g5/spike.mjs 1
pnpm -F @proj-airi/qa-tools exec tsx \
  /mnt/dev/projects/dtuber/.omo/evidence/agent-qa-tooling/g5/spike.mjs 2
```

The spike is deliberately not committed. The only committed artifact
is this findings note. Required documentation verification is
`pnpm verify --base origin/main`, with output saved in `checks.txt`.
