---
slug: live2d-cursor-touch-integration
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/live2d-cursor-touch-integration.md
plan_sha256: 9fce02913c5169a74b160b5bc16919084d29ad5ae0704f34e15fd29d1e10f236
review_round_id: r10-mvltc57q
review_round_limit: 10
pending-action: handoff (execution via /ulw-execute)
phase: review_round_initialized
round_status: approved
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/live2d-cursor-touch-integration.md
    round_id: r10-mvltc57q
    plan_sha256: 9fce02913c5169a74b160b5bc16919084d29ad5ae0704f34e15fd29d1e10f236
    launch_id: r10-mvltc57q-l1
    session: st_01a16bdb
    result: OKAY
approach: "Replace binary cursor gates with one seeded, continuous cursor-attention model in the Natural controller (staged notice -> full attention, distance-dependent independent engagement), head-anchored radial cursor mapping, velocity-limited eye pursuit with catch-up saccades, a rate-independent overshoot-tolerant pet classifier, melt-into-hand pet handoff, prompt y-aware pokes, touch events in the motion-scenario contract, ADR updates; T1 tests + one real-OS-cursor rendered check on ForBOOTH."
---

# Draft: live2d-cursor-touch-integration

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Users:
- Luke at his Windows desktop: AIRI Electron stage window (transparent, always on top, click-through over transparent pixels) in a screen corner, Natural motion driver, ForBOOTH / Bear Pajama rigs. His mouse roams the whole desktop for other work and sometimes comes over to pet (hover strokes on the head) or poke (click). Goal: "a VTuber stuck in the corner of my screen".
- Programs: Natural controller consumers (Model.vue adapter, qa-tools scenario-sink T1, scripts/bench-natural.ts, T3 gates with cursor attention off), the web stage host using the same Live2D scene, the Universal driver eye tracking path (focusAt, model-eye-offset).

IS-1 | A far-away cursor never pins her gaze to a fixed corner; attention to it falls off with distance and its direction varies continuously with the true direction from her head | from a corner window most of the desktop saturates today
IS-2 | Approach from any side or speed reads the same: attention ramps up smoothly as the cursor nears, no fast sweep when it crosses her own box | approach-direction artifacts
IS-3 | Eyes follow a moving cursor at a bounded speed with catch-up saccades; head follows the gaze with lag, body follows head; head and eyes do not point at different targets for long | eyes zero-lag, head/eye fight
IS-4 | A cursor that stops moving fades out of attention gradually | 1 s timeout snaps to camera
IS-5 | Petting at any natural stroke speed, width, direction and pointer rate (60-144+ Hz) holds one continuous pet; a cursor merely passing over the head still never pets | speed/rate/overshoot flicker
IS-6 | Approach -> pet start -> petting -> pet end is continuous: no look-up-then-duck, no camera snap at start, no snap to hand/camera at end | binary cursor gate
IS-7 | Her pet response follows vertical as well as horizontal strokes | roll uses hand x only
IS-8 | A poke visibly reacts promptly to the press, its direction reflects where it landed (x and y), and pets/drags never misfire as pokes | release-time trigger, x-only
IS-9 | Nothing regresses: T1 idle liveliness gate passes, controller stays seeded-deterministic and exactly neutral when no cursor/touch, cursor-attention toggle off removes all cursor influence, Universal eye tracking and the web host keep working | existing contracts
IS-10 | These behaviors are machine-checkable: deterministic tests drive cursor paths and touch; a rendered check drives the real OS cursor | QA has no touch input today

GAP-1 | cursor normalized to padded model-canvas center, per-axis clamp ±1, no distance term (Model.vue createNaturalAdapter attention cursor) | IS-1, IS-2
GAP-2 | gaze 'cursor' target resolves live each step: no pursuit velocity limit, no catch-up saccades (gaze.ts resolve/gazeAt) | IS-3
GAP-3 | cursor presence is binary everywhere: Live2D.vue 1000 ms timeout, pet/aside/screen null it in integrate(), setCursor saccades on null transitions | IS-4, IS-6
GAP-4 | 20% of fixations leave the cursor while the head bias stays on it; posture shifts keep full amplitude during tracking | IS-3
GAP-5 | pet movement test is per-sample (reversalStep/2 = 0.01 head) -> rate-dependent; trail cleared on any off-head sample; 600 ms idle | IS-5 (simulated: 144 Hz 1.2 head/s flickers every ~0.5 s; ±0.6 never pets)
GAP-6 | before a pet qualifies she tracks the hand (looks up), then drops into the bow; at pet end the cursor returns -> saccade to hand, then 1 s later camera | IS-6
GAP-7 | pet roll follows hand x only; no vertical response | IS-7
GAP-8 | poke fires on release (<=400 ms) and peaks ~0.4 s later; pokeDirection ignores y | IS-8
GAP-9 | motion-scenario contract has cursor events but no touch; scenario-sink sets pet: null | IS-10

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
C1 | head-anchored radial cursor mapping with distance falloff | active | Model.vue createNaturalAdapter, Live2D.vue, head-anchor.ts
C2 | continuous attention weight + gaze pursuit + coherent head/body follow | active | natural-motion.ts integrate/follow, gaze.ts
C3 | rate-independent, overshoot-tolerant pet classifier | active | touch-gestures.ts
C4 | touch <-> attention handoff: approach, pet start/end, poke on press, vertical pet response | active | touch.ts, pending-actions.ts, natural-motion.ts, Model.vue onTouchPointer
C5 | deterministic QA hooks + ADR/doc updates | active | packages/stage-shared/src/motion-scenario, packages/qa-tools/src/motion/scenario-sink.ts, docs/ai/adr/2026-10-18-live2d-touch-interaction.md

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
A1 | Controller owns cursor recency; Live2D.vue keeps the last position without the 1 s expiry when driver is natural; other drivers keep the timeout | removes snap gate | yes
A2 | Cursor offset relative to an eye anchor (head box center x, 0.55 of box height) in head widths; radial soft saturation m(r)=r/sqrt(r^2+1.2^2); fallback anchor when no head | approach-side independence | yes (named constants)
A3 | Eye pursuit max 1.5 eye units/s, catch-up saccade at error >0.1, saccade events only >=0.08; head followers slowed to 0.22/0.26 s; head relaxes 60% while gaze is off the cursor | coherent eye/head | yes
A4 | Pet idle detection by anchor travel 0.03 head widths (rate independent); margin zone side/top 0.5, bottom 0.15 head widths; qualify needs >=50% trail time inside the true box; pet hand becomes {x,y} | IS-5/IS-7 | yes
A5 | Hover-mode poke commits at press+90 ms if still, release commits earlier; requireHold keeps release semantics; poke nudge tau 0.12-0.18 s; pitch direction uses y (top of head bonks down) | IS-8 | yes
A6 (revised after plan-consultant F1/F3/F13) | 'screen', ACT 'aside', and the disabled toggle all dismiss; a dismiss edge saccades whenever the episode is oriented (phase notice or full) and is a silent no-op when idle/ignored or after release, so an already-faded cursor never snaps and existing test 527 (eased saccade on screen) holds | resolver flips to screen 3 s after the cursor stops (performance-state/index.ts:183), by which time the controller's own rest decay has already released | yes
A7 | While a canvas pointer sample is younger than 100 ms, Model.vue uses it as the cursor source instead of the 60 Hz screen poll | one input for gaze and touch | yes
A8 | After a pet longer than 3 s, one 1.2 s glance to the camera at pet end; otherwise no forced camera saccade | 'looks up at you' moment | yes
A9 | Rendered check on ForBOOTH only (Luke's one-rig acceptance rule); naturalness stays Luke's T4 review | memory: human.md 2026-10-18 | yes
A10 | No-cursor and no-touch paths draw no new random numbers; new randomness uses an appended stream index | keeps idle gates and equivalence tests stable | yes

## Findings (cited - path:lines)
- Investigation report (this session) six findings; GAP rows above carry them.
- Pet classifier simulation (real Live2DTouchGestures, this session): 60 Hz ±0.3 strokes: 0.3 head/s never; 0.5-0.55 start+end same frame; >=0.8 ok. 144 Hz: 0.8 and 1.2 head/s flicker; >=1.5 ok. ±0.6 strokes never pet.
- Cursor source: main process polls screen.getCursorScreenPoint at 1000/60 ms (electron-vueuse/src/main/loop.ts:11), sends only on change (apps/stage-tamagotchi/src/main/services/electron/screen.ts); renderer page passes window-relative mouse (apps/stage-tamagotchi/src/renderer/pages/index.vue:420).
- Stage.vue:483-524 uses cursorMovedAtMs for performance attention ('cursor' vs 'screen' in watching mode; ADR natural-motion-v2 line 62).
- Touch ADR docs/ai/adr/2026-10-18-live2d-touch-interaction.md records thresholds and the binary pet cursor rule; must be updated with the change.
- Existing tests: touch-gestures.test.ts (7 cases), gaze.test.ts, natural-motion.test.ts cursor/pet/poke cases (lines ~160-633, 878), natural-motion-adapter.test.ts 'preserves cursor distance, reversal, expiry, and asymmetric bounds' (line 267) encodes current cursor contract.
- QA: T1 scenario-sink supports cursor events (scenario-sink.ts:156-239), pet: null; T3 gates run with cursorAttention false and park the cursor via SetCursorPos (packages/qa-tools/src/t3/cursor.ts).
- model-eye-offset setting only feeds useLive2DEyeFocusFor (Universal focus + Natural cursor input).
- Worktree: main clean at 4e9d78fd9 (27 ahead of origin, unpushed).
- Corrected by plan-consultant F8: Kirie passes cursor-position to the same WidgetStage (apps/stage-tamagotchi-kirie/src-web/src/renderer/pages/index.vue:311-314,348); it is a typecheck-only consumer.
- Plan-consultant round (st_01a16bba) folded: F1 dismiss gating, F2 cooldown draw timing, F3 full test-update list, F4 stage-ui bridge switch case, F5 pointer counted as dispatched, F6 head in CSS px + screen/dpr converted in qa-tools, F7 press dwell, F8 Kirie, F9 runT1 host, F10 cursor/pointer precedence, F11 constant copy, F12 NOTICE markers, F13 permission re-open, F14 T3 configure/park order, F15 live smoke moved to todo 10/F3.

## Decisions (with rationale)
- D1 (Luke) Pet response: melt into the hand - eyes drift down and soften toward half-closed as the hand arrives, head leans into strokes; no look-up, no camera snap.
- D2 (Luke, own words): "In terms of idle movement, it should always look like notice -> full attention. That said, the goal is to have her feel like an independent 'vtuber stuck in the corner of my screen' so sometimes she should pay attention medium/far, sometimes not." -> onset is always staged (notice glance/orient first, full attention after); at medium/far distance engagement is a seeded draw per cursor episode with probability falling with distance, and she disengages on her own after a drawn interest span; near cursor always gets noticed.
- D3 (Luke) Add touch events (pointer path, press, release) to the motion-scenario contract and qa-tools scenario-sink; plus one real-OS-cursor rendered check.
- D4 (Luke) No new user settings; existing toggles keep their meaning.
- D5 (Luke) Tests-after.
- Stance: one-by-one; Luke chose the recommended option on 4 forks and gave a custom constraint on the far-cursor fork.

## Scope IN
- packages/stage-ui-live2d: natural-motion facade, gaze, touch, pending-actions, impulses (poke nudge tau), new cursor-attention module, touch-gestures, touch-regions, Model.vue, Live2D.vue, tests.
- packages/stage-shared/src/motion-scenario (touch events), packages/qa-tools/src/motion/scenario-sink.ts (+ a rendered touch/cursor check script).
- docs/ai/adr/2026-10-18-live2d-touch-interaction.md, docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md (cursor sections).

## Scope OUT (Must NOT have)
- No new user settings, i18n strings, or settings UI.
- No change to Universal/MAGIC eye tracking behavior or the model-eye-offset setting semantics.
- No change to performance-state resolver constants or modes.
- No chat/LLM reaction to touch (touch event stays as is).
- No changes to Kirie, Godot, VRM, MMD scenes.
- No new dependencies.

## Open questions

## Approval gate
status: approved (Luke, 2026-10-24: Approve)
next: on approval rerun scaffold without --draft-only, plan-consultant gap analysis, append todos, fill TL;DR, then plan-reviewer rounds (max 5).
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Review ledger
- Round 1 (r1, session st_01a16bc3, plan-reviewer): REJECT -> changes_requested. Accepted blockers (frozen ledger):
  - B1 todo 1 hover poke commit vs IS-8 drag guarantee -> IS-8 narrowed (drag = movement within 90 ms), delayed-drag tests (i)(j) added.
  - B2 slow petting impossible under fixed petStartTravel 0.5 / window 1000 -> window 1500, travel 0.35, slow-stroke test (h), IS-5 speed range 0.25-6 head/s.
  - B3 pursuit landing velocity v = vt exceeds the 1.5 limit -> landing and pursuit-start velocity limited; invariant documented.
  Non-blocking notes: none.
- Round 2 (r2-mvlsgea4): completed: REJECT -> changes_requested (session st_01a16bc5) against sha 5e5dc45e15c61d5a9fd159f5fc37924dc677cc6045a341227954b2c6a4565f38.
  New findings passing eligibility (explicit requirement IS-8/IS-1/IS-6):
  - B4 early drag that returns or releases early could still poke -> persistent eligibility cancel at pokeMaxTravel 0.05; tests (i)(i2)(i3).
  - B5 IS-1 distance falloff missing -> distance gain g(r) (1 within 2, 0.35 at >=10) on head pull; tests todo 2 (a2), todo 6 (d2).
  - B6 approach case (d) geometrically impossible and formula contradicted it -> realizable vertical descent, approach smoothstep(1.6, 0.9), monotonic non-increasing pitch, <= 0 near head.
- Round 3 (r3-mvlsjiv4): completed (session st_01a16bc7): REJECT -> changes_requested against sha c2b87c0d43093959a5d4a0658a5fd2919ead2cd84ba3de1d73f48431901e2610.
  New finding passing eligibility (acceptance unreachable):
  - B7 todo 6 case (e) baseline-relative mirror symmetry impossible under symmetric attention calming -> replaced with identical events, equal headY/eyeY, positive headX(right)-headX(left), and pre-compensation fixation.x ordering; same class pre-empted in todo 9 case (d) (final-1 s mean fixation sign, headX difference).
- Round 4 (r4-mvlsn3ao): completed (session st_01a16bca): REJECT -> changes_requested against sha 94fa8bfe75d71a191176b496fd1521e31ed1027288a9089724df75f02d0e3b75.
  New findings passing eligibility:
  - B8 IS-4 under real resolver timing: rest decay too slow (w 0.42 at 3 s) -> restHold 0.6, restTau 0.8, fadeTau 0.5 (simulated: below releaseAt at 2.18 s, 0.12 at 3 s); todo 2 (d) re-timed; todo 6 (l) real 3 s screen switch.
  - B9 todo 3 changed saccadeCount semantics against gaze.test.ts:67-79 -> semantics preserved (every saccade counts; catch-ups only fire above 0.1); saccadeEventSize removed; case (c) re-stated.
  Pre-empted same-class issues: todo 6 (g) now asserts on attention events, not saccade timing; todo 1 (h) slow strokes at plus/minus 0.15 (reversal each second).
  Prototype evidence (scratch copy of touch-gestures.ts with window 1500, travel 0.35, anchor idle 0.03): one pet-start and no pet-end over 5.6 s at 0.3 head/s (60/144 Hz) and 1.2 head/s (30/60/144/240 Hz), 6 head/s at 144 Hz; a slow straight pass emits nothing.
- Round 5 (r5-mvlsta8s, final allowed): completed (session st_01a16bce): REJECT -> changes_requested against sha 572073efd349979fdf7d5a1132ed8c20080089673067659e6068845e057b411a.
  New finding passing eligibility (IS-9, existing test 527):
  - B10 dismiss during notice (w ~0.26 < releaseAt) was silent and left gaze pursuing the cursor -> dismiss emits for any oriented episode (notice/full); gaze.dismiss leaves a cursor target with weight 0; tests todo 2 (f4), todo 3 (e2), todo 6 (m).
- Review cap (5 rounds) reached without unconditional approval. Fix for B10 applied after round 5; current plan sha 9482cb0c313ee839b85c56a9c4f75ca3f2084d4b0f69222979c1b80c334e89f0 is unreviewed. Awaiting Luke: run another round / accept / adjust.
- Luke (2026-10-24, explicit): "Keep running the loop for another 5 rounds." -> review_round_limit 10.
- Round 6 (r6-mvlsycfh): completed (session st_01a16bd1): REJECT -> changes_requested against sha 9482cb0c313ee839b85c56a9c4f75ca3f2084d4b0f69222979c1b80c334e89f0.
  New finding passing eligibility (IS-4/IS-9):
  - B11 fading weight re-enabled cursor fixations after release/dismiss -> fixation eligibility gated on attention.oriented (notice/full); head bias keeps fading on w; tests todo 3 (e3), todo 6 (n).
- Round 7 (r7-mvlt1ujj): completed (session st_01a16bd4): REJECT -> changes_requested against sha 71cf504137404dbacfb1bb790665c26afb1666e1408e43e9aa9e02afdafbc1c1.
  Regression introduced by the B11 fix (eligible):
  - B12 todo 6 (n) separation at release+0.1 s contradicted disengage's 0.3 s frozen hold -> release path checked from +0.39 s, dismiss path from +0.15 s; immediate disabling proven by todo 3 (e3)(e4).
- Round 8 (r8-mvlt4fjx): completed (session st_01a16bd6): REJECT -> changes_requested against sha 8b116c06bf7cdf286e402fc1af52a37509e9fcd8ddf3a0dd6d645c2d6407f509.
  Findings (acceptance unreachable):
  - B13 todo 6 (e) exact headY/eyeY equality invalid (saccade timing depends on mirrored distances) -> events identical, headX difference > 0 after engage + 0.3 s, mean fixation.x sign per run; no Y/per-step gaze comparison.
  - B14 todo 4 mutation could not fail case (a) -> new case (a2) re-pet with opposite hand after settle; mutation targets (a2).
- Round 9 (r9-mvlt86e3): completed (session st_01a16bd8): REJECT -> changes_requested (sole blocker = pre-found B15) against sha f804a371b13ba3db9a13f448edafcded38b3d7fcf9911dd11dc62d56dd4f2f69.
  Self-found fix, confirmed by round 9 and applied:
  - B15 todo 3: predictive catch-up endpoint target + vt*(dur+0.03) with landing v = vt overshoots on a step (simulated: 3 catch-ups for a 0.5 step, so case (b) 'exactly one' fails). Fix: endpoint = current target, landing v = 0 (simulated: step 1 catch-up, 0.05 step 0, 4 u/s sweep max pursuit speed 0.79 <= 1.5).
  - Case (c) settle bound made concrete (within 0.01 by 1.0 s).
- Round 10 (r10-mvltc57q, last of the extended cap): completed (session st_01a16bdb): OKAY (unconditional) against sha 9fce02913c5169a74b160b5bc16919084d29ad5ae0704f34e15fd29d1e10f236.
- Final live-plan validation before handoff: sha 9fce02913c5169a74b160b5bc16919084d29ad5ae0704f34e15fd29d1e10f236 matches the approved round digest.
