# Land luke/feat/fullscreen-stage on main behind the experimental flag

Status: decisions settled 2026-11-04; not executed.

## Goal

Move the 3D desktop stage, locomotion, and MMD clip work from `luke/feat/fullscreen-stage` onto `main` in six verified slices, then retire the branch. The trunk-and-flag structure is recorded in `docs/ai/adr/2026-11-04-lazy-3d-renderers.md`; what each renderer performs is in `docs/ai/adr/2026-11-04-interaction-portability.md`.

## Decisions (Luke, 2026-11-04)

- The off-by-default **Experimental 3D stage** setting gates the desktop host only: the transparent full-screen window, click-through, drag, locomotion, home persistence, and floating-chat anchoring. MMD clips, curation, and the lazy MMD body work in the classic window whenever an MMD model is selected.
- `AIRI_STAGE_HOST=desktop` overrides the setting in development builds only. Production builds obey the setting.
- Switching away from MMD while the desktop host runs keeps the host until restart and shows a notice that offers to relaunch into the classic window.
- Land the window-rect sensor spike, env-gated, with the 2026-11-04 measurements (4 Hz worker polling: about 0.75 ms per sample, under 0.5% of one core, main thread unaffected). Drop the obsolete stage spike host.
- Defaults not asked: the 252-file `.omo/worktree-archive` stays off main; M3 counts as accepted only after Luke's own QA; the branch retires after the last wanted slice lands.

## Rules for every slice

- Transplant onto current `main`; never merge the branch wholesale. Split mixed commits by file or hunk.
- Keep today's boundaries: `StagePerformanceDriver` (`'natural' | 'basic'`), ungated ACT `gesture` routing beside MMD `action`, the shared `NaturalTouchGesture` and `NaturalTouchGestures`, Natural lab commands as events, async `MMDScene` and `ThreeScene`, no global Tres, face-baseline delivery, and the neutral i18n keys.
- Eager code imports only the three-free 3D subpaths. New MMD overlay flags go in `composables/mmd/overlay-flags.ts`, never `overlays.ts`, because `/stores` is eager.
- Each slice is a branch and a pull request against `lschneiderny/airi`. Every commit passes `pnpm verify`, and the slice passes `pnpm check:bundle`. Agent guidance travels in its own commit.
- No live Electron QA; Luke QAs after landing.

## Slices

### 1. Neutral motion and world foundations

Commits: `6b4333298` (stage-world calibration), `070b27918` (arm rest pose, finger bones, clip masks), `b55828aa6` (gait), `71bbc1634` (clip kind from mask); the neutral director parts of `bc0b851f7`, `f3396db9c`, `48c4c8aa9`, `bc8117db2`, `7c8250f7a`, and `42f6ed83c`.

Expect conflicts in the stage-shared README and in `eslint.config.ts`, where the stage-world purity extension sits beside `airi/lazy-3d-renderers`.

Pass: pure package tests and typechecks; motion-driver packages import no Vue, Pinia, Three, or renderer code.

### 2. Neutral action contracts, tools, prompt, and evaluation

Commits: `c4ae8e40c` (ACT `action` label), `89577ba6c` (actions prompt segment), `223ec307c` (model-eval scoring); the shared tool, conductor, and runtime-state parts of `f3396db9c`, `774e10a8c`, and `c5a948596`.

Expect conflicts in the conductor and its tests, the routing test imports, and the runtime prompt tests. Keep face baselines, the neutral driver type, and the numeric-mood exclusion.

Pass: parser, orchestrator, tool lifecycle, prompt composer, and eval parity tests. Live2D exposes no body or clip tools and no action labels.

### 3. Lazy MMD body and stage-world adapter

Commits: `bebd26311`, `f42ecd7bc`, `23079a233`, `fdddec395`, `9c0d1a00f`, `e732cb112`, `38955305f`, `127353d18`; the metrics part of `99f586533`; the MMD and alpha-reader parts of `61563a427`; the adapter parts left from slice 1; matching `a7265ff04` documentation.

Expect conflicts in `MMD.vue`, the diagnostics store, overlays, the MMD store, and `Stage.vue` touch, placement, and root routing.

Pass: MMD node and browser tests and the Stage routing tests; the shared touch path, emotion strengths, gesture, mood, and baseline surface stay intact; MMD code is reached only through dynamic imports.

### 4. Flagged desktop host and the sensor spike

Commits: `3db0f7fd7`, `599555c2e`, `ad11d9b1e`, `69e6bfade`, `713509b1e`, `bd7a91857`; the host parts of `99f586533` (the spike host itself is dropped) and `61563a427`; `b1537808b` and `47cb077ca` (sensor spike); host documentation from `a7265ff04`.

New work:

- Add the Experimental 3D stage setting, default off, and enforce it in the main process before host and window creation (`selectHostMode` and the `setupStageWindow` branch in `apps/stage-tamagotchi/src/main/index.ts`).
- Honor `AIRI_STAGE_HOST` only when `import.meta.env.DEV` is true.
- Show a relaunch notice when the renderer leaves MMD while the desktop host runs.
- Record the 2026-11-04 sensor measurements next to the spike.

Pass: mode, config, RPC, window contract, click-through, placement, chat anchoring, and tray tests; with the flag off, a Live2D user keeps the classic window and input; tests cover the dev-only override and the relaunch notice.

### 5. Lazy MMD clip runtime and curation

Commits: `9ab8c3772`, `070a52799`, `aba97ad95`, `ee79cd1dd`, `4d14b491c`, `9af404af9`, `244dd6998`, `bd006ab67`, `806c776d5`, `976aa2295`, `673f8e186`; the adapter parts left from `7c8250f7a`, `774e10a8c`, `c5a948596`, and `42f6ed83c`; `356a77c96` documentation.

Fix `4d14b491c`'s `@proj-airi/stage-ui-mmd` root import in `model-settings/mmd.vue`: stores from `/stores`, clip helpers from their renderer-neutral owner.

Pass: clip metadata, layers and ownership, director refusals and pre-emption, action-port lifecycle, curation reset and re-import, prompt exposure, and routing tests; procedural gestures stay renderer-neutral.

### 6. Plans, guidance, and retirement

- Reconcile `.omo/plans/mmd-actions-library.md` with the implemented M3 commits instead of re-running it. Remove its branch workflow (K7, the worktree path, merging main into the branch, per-wave pushes, never-main). Separate implemented runtime from missing acceptance evidence, and add `pnpm check:bundle` and the flag to its acceptance.
- Update `docs/ai/3d-character-roadmap.md` (from `356a77c96`): M3 implemented and pending QA, M4 sensor measured, and display hand-off still open.
- Transplant relevant guidance from `56f0d92e7` and `c91b2dc66` in separate commits.
- Drop `11e64887c`, `61371bbc6` (merges), `c0200f76f` (already on main), the stage spike host, and the worktree archive (`f4995b174`).
- Retire `luke/feat/fullscreen-stage` and its worktree with `pnpm wt rm fullscreen-stage` once the final `main` passes both checks.

## Source

The full commit and file inventory, conflict map, and eager-import audit are in the 2026-11-04 inventory task output (st_01a1a7a3). Memory: `reference/projects/dtuber-3d-track-structure.md`.
