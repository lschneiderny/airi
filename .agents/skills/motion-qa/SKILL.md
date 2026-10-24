---
name: motion-qa
description: Run motion, emotion, or idle QA, including deterministic gates, headless rig checks, rendered Electron scenarios, and visual review.
---

# Motion QA

Run `pnpm qa:doctor` first. Resolve reported failures before starting a check. Doctor reports setup problems and never fixes them.

## Choose a level

- T0 checks local unit behavior.
- T1 proves deterministic controller behavior and scores emotion effects relative to the same-seed stripped run and idle noise. It does not use a rig.
- T2 runs the real ForBOOTH rig with Cubism Core, physics, and pose in headless Node. It does not prove rendered pixels.
- T3 drives the Electron app through the development-only bridge and records traces and screenshots. Keep its window visible during capture.
- T4 is Luke's visual review. Scores do not judge naturalness.

Use the lowest level that answers the question. T1 and T2 use the shared scorer. T3 proves transfer to the rendered app, not statistical confidence or naturalness.

## Commands

```bash
pnpm qa:doctor
pnpm qa:test --all
pnpm qa:motion gate emotion --level t1
pnpm qa:motion gate liveliness --level t1
pnpm qa:motion gate emotion --level t2 --rig forbooth
pnpm qa:motion gate emotion --level t3 --rig forbooth [--t1-report <run dir>]
pnpm qa:motion gate liveliness --level t3 --rig forbooth
pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke
pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch
pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch-pass
pnpm -F @proj-airi/qa-tools exec vitest run src/motion/touch-scenarios.test.ts
pnpm qa:motion gate emotion --level t3 --rig forbooth --rescore <gate run dir>
pnpm qa:motion validate-scorer --level t1
pnpm qa:report <runDir>
```

The `builtin:t3-touch` scenario pets, pokes, and triggers the touch blush with the real OS pointer. `builtin:t3-touch-pass` verifies that a passing cursor does not start a pet. The T1 touch suite covers deterministic touch behavior. T3 touch runs move the real OS cursor and need an undisturbed desktop; the runner refuses paths outside the virtual screen and stops when the reported head is implausible.

Set `AIRI_QA_RIG_FORBOOTH` to the local ForBOOTH rig directory for T2 and T3. Set `AIRI_QA_CUBISM_CORE` when the core is not at the current checkout's default path. `AIRI_QA_RIG_BEAR` is an optional doctor input; Luke's rule says acceptance on one rig counts for the other. The bridge is enabled only when the build is development and both `APP_REMOTE_DEBUG=true` and `APP_MOTION_QA_BRIDGE=true` are set. T3 uses `APP_USER_DATA_PATH` for a temporary profile and manages its remote-debug port internally. Do not reuse a personal Electron profile.

Gate selection and environment values are recorded in the run manifest. A reduced `--seeds` run is not the full committed gate.

T3 emotion runs use the committed `natural-emotion-t3` version 2 gate across three 300-second sessions. The session-stratified placebo null has 52 windows total in the accepted run. It checks visibility, face transfer ratio [0.7, 1.3] against the same-commit T1 reference, and gross release regression. Posture is pooled and reported, not gated. T3 liveliness uses three 600-second captures with the cursor parked.

For `--rescore`, the runner verifies each archived scoring artifact against its capture-time SHA-256 in `run.json`, then checks layout invariants, session headers, and exact trace-event identity. A named invariant refusal exits 2 before creating a run directory. The manifest is trusted, so rewriting an artifact and its recorded digest together is not detected. T3 also needs an UNDISTURBED desktop: mouse movement fails cursor parking, while focus or occlusion changes can throttle frames. Warn the user before a long capture; Luke accepted the interference-affected T3 runs from 2026-10-20.

## Required limitations wording

Every motion QA report and verdict must state:

> Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

The desk VTS recordings are valid for idle liveliness only. Naturalness remains Luke's visual call. ForBOOTH's watermark covers part of the face in T3 screenshots; under Luke's rule, acceptance on one rig counts for the other.

Gate wall time is recorded, not asserted; no test fails on timing. On a quiet 16-core machine at the integration tip, the full T1 emotion gate took 294.6 s against a 300 s target. The angry/strong smoke subset took 44.7 s and 45.5 s, and an independent run took 65.0 s, against a 60 s target. Luke accepted these measurements on 2026-10-20. Under load, times rise; the full gate took 415.6 s. Record the machine load with any timing.

## Gates and known failures

Gate ids, versions, metrics, and budgets live in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts`. If a gate changes, edit that file and bump its version in a commit before running it. Never retune a gate or a Natural recipe to pass a failing run.

`pnpm qa:test` compares results with `packages/qa-tools/known-failures.json`. Report new failures as findings. Do not skip, delete, or weaken tests. Add a known-failure entry only with a concrete cause, date, and removal condition. Remove fixed entries when the runner reports them as fixed.

Scorer validation uses protocol 2, fixed before the first full run. The run passed A/A, zero, mutations, and determinism, but unmutated failed: 37 checks were persistent findings, grouped by failed criterion as visibility 7, significance 6, release 31, and size 3. The remaining 66 noise failures exceeded the budget of 25 over 1,500 check-set pairs, missing the prediction that only persistent findings would fail. No constants, recipes, or gates were retuned. See `docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md` for the rules and full findings.

## Evidence and heavy runs

After validation passes, `qa:test`, `qa:motion gate` at T1/T2/T3, direct `qa:motion t3`, and `qa:motion validate-scorer` create unique `.temp/qa` runs with `run.json` manifests. T3 also creates a run per capture session; emotion `--rescore` creates its run only after archive validation succeeds. Doctor prints findings only. `qa:report` writes into its first input run or `--out`, without a new run or manifest. Evidence archive writes under `.omo/evidence/<slug>` with its own `manifest.json`, not a QA run. Preserve manifests and artifacts for commands that create QA runs. Before removing a worktree, archive plan evidence into the main checkout:

```bash
pnpm -F @proj-airi/qa-tools run evidence archive --plan <slug> --from <worktree-path>
```

Do not commit evidence or rig/core assets. Heavy runs take a class from the CPU slot budget: gate runs take `gate`, and T3 captures take `exclusive`, which waits until no other lease holds slots. Run `pnpm slots status` before a heavy run to see the current holder and queue. Never overlap T3 captures with browser suites, builds, root typecheck, or lint. Let the broker queue a run rather than starting it by hand.

Acceptance evidence needs `--fresh` on every T1 gate and `validate-scorer` run, so the result is computed rather than read from the cache. A cached run is a local check. `--t1-report` refuses a cached run with exit 2, so pass a run made with `--fresh`.

For details and current gate behavior, read [`packages/qa-tools/README.md`](../../../packages/qa-tools/README.md) and [`docs/ai/adr/2026-10-20-motion-qa-levels.md`](../../../docs/ai/adr/2026-10-20-motion-qa-levels.md).
