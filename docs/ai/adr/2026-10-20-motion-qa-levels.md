# Motion QA levels and committed gates

Date: 2026-10-20
Status: accepted

## Context

Checkpoint-12 showed that the former per-capture rules were too noisy for still and idle motion. Emotion-free recordings failed the release rules in 34% to 99% of samples, while the head-sign rule failed about half the time. Those results made rendered captures a poor place to answer statistical questions.

The motion QA work separates deterministic controller checks, real-rig execution, rendered transfer, and visual review. T1 and T2 run scenarios through the same scorer. T3 drives the Electron renderer through a development-only bridge. The system reports evidence and findings; it does not retune motion to make a verdict pass.

## Decisions

### Levels

- T0 runs unit tests for local contracts.
- T1 runs deterministic scenarios through the real decider, conductor, hold performer, Natural controller, and adapter without a rig.
- T2 runs the real ForBOOTH rig, Cubism Core, physics, and pose headlessly in Node at a fixed timestep.
- T3 runs scenarios in the rendered Electron app and records traces and screenshots.
- T4 is Luke's visual review of the numerical report and rendered evidence.

Each level answers a different question. T1 does not prove rig behavior; T2 does not prove renderer pixels; T3 does not prove statistical confidence from a single capture. No automated level judges naturalness.

### Idle-noise-relative scoring

Emotion results compare paired emotion and emotion-stripped runs with the same seed, then compare detectability against an idle placebo null. The scorer reports direction, size relative to the recipe, release, and detectability above the rig's own idle noise. Idle liveliness remains a separate score against desk VTS reference bands; those recordings are valid only for idle liveliness.

### Committed gates

Gate definitions are committed in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts`. Reports identify each gate by id, version, and source file SHA. A gate change requires editing `gates.ts` and incrementing its version in a commit before running it. Reduced seed selections are recorded and do not alter committed rules.

### Rendered bridge

T3 uses the Electron development app's remote-debug interface to reach a typed Eventa bridge. Bridge registration requires a development build, `APP_REMOTE_DEBUG=true`, and `APP_MOTION_QA_BRIDGE=true`. It adds no listening port, and production bundle checks reject bridge markers.

Eventa provides one typed dispatcher and validation boundary for requests and replies. It does not isolate the bridge from the application or provide a security boundary. The bridge is a test control surface, not an application API.

T3 is Electron-only. Kirie is outside this decision and remains out of scope.

### T2 license decision

The Cubism Core header identifies the file as Redistributable Code and refers to the Live2D Proprietary Software License Agreement. Luke decided on 2026-10-20 that evaluating the unmodified core in place for local, non-distributed QA is allowed. The core and rig are not copied into the repository, modified, or distributed.

## Consequences

- Agents run `pnpm qa:doctor` before QA, then select the lowest level that answers their question.
- Run directories record source provenance, selected gate and version, environment inputs, artifacts, and result. Evidence is archived to the main checkout before a worktree is removed.
- A committed known-failures registry distinguishes new failures from the existing baseline without treating known failures as passes.
- T2 is GO by path A. Its recorded parity difference against Chromium is zero across 600 frames and 281 parameters, and its measured Natural, adapter, and physics loop runs at 55.19 times real time. Mesh deformation is skipped because it does not write parameters and accounts for about 90% of frame cost.
- Quiet-machine timing is recorded, not asserted: smoke runs took 44.7 to 65.0 seconds against a 60-second target, and the full gate took 294.6 seconds against a 300-second target.
- Scorer validation has accepted limits: x0 detection is 92.9% because impulse hints remain; ignore-side detection is 83.3% because T1 fixes the hold side per emotion; x0.5 size detection is 64.4% because the size-band lower bound is exactly 0.5; and unmutated sets pass 84% to 88% of checks. Redesign is deferred to a separate plan. `validate-scorer` exits 1 when these thresholds are missed until then.
- Naturalness remains Luke's visual call. The ForBOOTH watermark covers part of the face in T3 screenshots. Under Luke's rule, acceptance on one rig counts for the other.
- Gate failures remain findings. They do not authorize recipe or threshold changes.
