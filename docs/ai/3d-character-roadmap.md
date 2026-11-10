# 3D character roadmap

This page tracks the milestones of the 3D (MMD, later VRM) character work. The ADRs record what each landed milestone decided; this page records order and status.

## Sources

The original roadmap lived in an out-of-repository design draft. That draft was not available when this page was written (2026-11-04, on a Mac, where the draft's Windows path does not exist). This page was therefore rebuilt from the sources in the repository:

- [3D character motion for MMD models](adr/2026-10-30-3d-character-motion.md) (M0 and M1)
- [Full-screen desktop stage and locomotion](adr/2026-10-31-fullscreen-stage-and-locomotion.md) (M2)
- [Clip actions for MMD models](adr/2026-11-03-mmd-clip-actions.md) (M3)
- The motion plans and their drafts: `.omo/plans/mmd-natural-full-body.md`, `.omo/plans/fullscreen-stage-locomotion.md`, `.omo/plans/mmd-actions-library.md`, and `.omo/drafts/mmd-actions-library.md` (the decision list D1 to D10)

The draft's three 3D-only tiers are not recorded in any of these sources, so they are not reproduced here. Luke should reconcile this page with the draft and add the tiers.

## Where the 3D work lives

The 3D work is on `main`. It landed from `luke/feat/fullscreen-stage` on 2026-11-06 in six slices (PRs #13 to #17 and this page's update), under the trunk-and-flag structure in [Lazy 3D renderers](adr/2026-11-04-lazy-3d-renderers.md):

- The MMD and VRM scenes load only when such a model is selected. `pnpm check:bundle` fails if three, three-mmd, three-vrm, or Tres reach the Live2D startup chunks, and the `airi/lazy-3d-renderers` lint rule rejects static imports of the 3D renderers outside their lazy entries.
- The Experimental 3D stage setting is off by default and gates only the desktop stage host: the transparent full-screen window, click-through, dragging, locomotion, home persistence, and floating-chat anchoring. MMD clips, curation, and the body work in the classic window whenever an MMD model is selected.
- `AIRI_STAGE_HOST=desktop` overrides the setting in development builds only.

## Milestones

| Milestone | Scope | Status | Record |
| --- | --- | --- | --- |
| M0 and M1 | Parity with the Live2D Natural character, then full-body life before walking: Natural extracted into `packages/motion-driver-natural`, the humanoid package, the MMD frame pipeline with a clean pose, the morph runtime, planted feet, weight shift, whole-body look-at, touch, and sit and sleep stances from imported clips. | Landed | [3D character motion ADR](adr/2026-10-30-3d-character-motion.md) |
| M2 | Locomotion. Luke first chose window-follow as the movement host; the plan replaced it with a full-screen desktop stage: a stage world and camera contract, a procedural gait, a home, walking to the chat, chasing the cursor, roaming, the relaxed arm rest pose, clip bone masks, and the body tools `come_here`, `go_home` and `look_at`. | Landed; the desktop stage host is behind the Experimental 3D stage setting | [Full-screen stage and locomotion ADR](adr/2026-10-31-fullscreen-stage-and-locomotion.md) |
| M3 | The action and gesture library: derived clip kinds and layers, per-model curation with an "AI may use" switch, layered gestures, full-body actions and dances that the director performs, the ACT `action` field, the `perform_action` tool, two stage gates and model-eval scoring. | Implemented on `main` (MMD); accepted only after Luke's QA | [Clip actions ADR](adr/2026-11-03-mmd-clip-actions.md) |
| M4 | Windows as terrain: a window-rect sensor, standing on and perching on windows (perching is decided by the director only), drag dangle, and pointing limited to the cursor, the chat and the foreground window. | Next, not built. The env-gated Windows sensor spike is on `main` and was measured on 2026-11-04 (4 Hz worker polling: about 0.75 ms per sample, under 0.5% of one core, main thread unaffected); `apps/stage-tamagotchi/src/main/services/electron/window-rects-spike.md` records the results, and its gates are in the clip actions ADR. | [Clip actions ADR](adr/2026-11-03-mmd-clip-actions.md), "The window-rect sensor spike" |
| Props | Objects she holds or uses. | Split out of M4; planned after M4. | Decision D7 in `.omo/drafts/mmd-actions-library.md` |
| M5 | The VRM adapter, consuming the renderer-neutral motion-driver packages and the stage-world contract without MMD assumptions. | Later | [3D character motion ADR](adr/2026-10-30-3d-character-motion.md), Follow-ups |

## Decisions that shape the order

These decisions were taken on 2026-11-02 for M3 and recorded in `.omo/drafts/mmd-actions-library.md`:

- D1: M3 first, with the M4 window-rect spike in parallel in the same plan. M4 planning waits for both.
- D2: The space model is the ground line now, with a terrain layer added later. Nothing in M2 changes for it.
- D3: The model gets two channels: an ACT field for short masked gestures inline with speech, and the `perform_action` tool for full-body actions and dances, gated by the director. Only exposed clips reach the prompt.
- D4: Dances play at native rate. Beat matching is a follow-up.
- D5 to D7: Perching is decided by the director only, pointing is limited to the cursor, the chat and the foreground window, and props are split out until after M4.

## Open across milestones

- Beat-matched dance playback (D4).
- Display hand-off: walking from one display to another. Built on 2026-11-10 ([display hand-off ADR](adr/2026-11-10-display-hand-off.md)). A crossing passes `stage-handoff` in a two-output headless KWin session; the crossing on physical displays is not yet checked.
- A `go_to` tool. M3 added no `go_to` or `list_actions` tool.
- A Live2D stage mode, which no milestone has scheduled.
