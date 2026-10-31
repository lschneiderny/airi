---
slug: mmd-natural-full-body
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/mmd-natural-full-body.md
plan_sha256: c248f9a1ceb1f8d78b3199d10a6fcec743f5536cc9e63073ad386d26ba89073e
review_round_id: r8-mvvn5tve
review_round_limit: 5
pending-action: none (run /ulw-execute from C:/Users/Luke/projects/dtuber-wt/mmd-natural-full-body)
phase: review_complete
round_status: approved
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/mmd-natural-full-body.md
    round_id: r8-mvvn5tve
    plan_sha256: c248f9a1ceb1f8d78b3199d10a6fcec743f5536cc9e63073ad386d26ba89073e
    launch_id: launch-r8-mvvn5tve
    session: st_01a18f48
    result: OKAY (unconditional)
approach: Extract pure Live2D Natural into packages/motion-driver-natural (move-only, seeded-trace byte-equal) and add a pure packages/motion-driver-humanoid (canonical VRM-named bones, rig-profile schema, look-at, foot contact + weight shift, stance director). In stage-ui-mmd build a frame pipeline with an own clean pose snapshot and absolute writes, a PMX morph runtime (group/vertex/bone/material/UV), an MMD Natural adapter, an MMD rig adapter, rigid-body touch colliders, stance clip slots, skeleton-based framing; generalize the stage performance conductor and expression catalog/panel to a renderer-selected backend so MMD implements StagePerformanceScene; add an MMD Motion Lab devtools page with per-stage timings.
---

# Draft: mmd-natural-full-body

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- U1 Luke as end user: Tamagotchi (Electron, Windows) with an MMD model as desktop companion. Today: MMD stands static (no idle VMD ships), simple eye/head cursor gaze after physics, slot-based emotion morphs, lip-sync, blink. After: alive like Live2D Natural plus full-body behaviour.
- U2 Luke as developer/QA: tunes motion, runs tests and QA. Today: Natural lab + qa-tools gates for Live2D only; nothing for MMD. After: MMD Motion Lab, deterministic Node tests for pure layers, browser tests for the pipeline.
- U3 Live2D path (Luke's ForBOOTH/Bear rigs, qa-tools gates): must behave identically after Natural moves.
- U4 LLM/chat runtime (ACT markers, expression tools): today expressions only reach Live2D. After: same tools and ACT expressions drive MMD catalog entries.
- U5 Future VRM adapter author (M5): consumes the neutral packages without MMD assumptions.

| id | ideal-state property | reason |
|---|---|---|
| IS-1 | Live2D Natural output is identical after extraction: seeded traces byte-equal, all stage-ui-live2d + qa-tools tests and gates unchanged | U3 must not regress; seeded determinism makes this provable |
| IS-2 | An MMD model runs the same Natural behaviour as Live2D (blink, breath, posture drift, saccades, cursor attention, chat glances, speech emphasis, emotion impulses/holds/mood, energy by PerformanceState) from the same Stage inputs | Parity decision |
| IS-3 | Every PMX morph type takes effect: vertex, group (members of any type, nesting refused with a warning), bone, material, UV | Vivian eyebrows and WuWa material/UV effects are inert today |
| IS-4 | MMD expressions come from a per-model catalog derived from PMX morphs, curated in the same expression panel as Live2D, persisted per model id; LLM expression tools and ACT expressions drive it; lip-sync owns the vowels, blink owns the blink morphs | U4 parity; one panel to learn |
| IS-5 | Feet stay planted in model-root space during idle sway and weight shifts (drift < 0.05 MMD units), knees stay inside rig limits, on all 12 local variants incl. Ellen (no waist-cancel) and Vivian (mode-2 leg helpers) | Full-body life; nothing skates |
| IS-6 | Seeded weight shifts move the pelvis between the legs with hip/upper-body coupling, composed with Natural body output | 3D-only life |
| IS-7 | A 3D look-at aims eyes -> head -> neck -> upper body at a world target (cursor on the stage plane, chat window, camera) with a body turn past a threshold and hysteresis; hair reacts because all bone writes precede physics | 3D-only gaze; fixes today's after-physics gaze |
| IS-8 | Pointer poke/pet on MMD head/body (rigid-body colliders, mesh fallback) triggers Natural poke/pet with Live2D semantics; head/body bones move before physics so hair/skirt react | Touch parity + physical response |
| IS-9 | Per-model stance clip slots (idle, sit, sleep) from imported VMDs; a pure director sits after sustained idle and sleeps while away, stands otherwise; cross-fades; a missing slot keeps standing; Natural ducks during stance clips | Stances via imported clips decision |
| IS-10 | Existing MMD features keep working: VMD import/idle/one-shot, emotion->action map, lip-sync, gaze modes on the Classic driver, physics/IK/grant/gravity toggles, materials, glow, lighting, background, capture, cross-window settings sync | No regression for U1 |
| IS-11 | The camera frames the model from skeleton-derived bounds (foot baseline to head top), so long-skirt Elysia frames like the others | Bounding box misframes (audit 6.2) |
| IS-12 | Per-frame cost is measured per stage and the full pipeline holds 60 fps on standard Chisa (922 bodies) in the Electron stage on Luke's machine | Heaviest local model; no degradation |
| IS-13 | An MMD Motion Lab devtools page shows the rig report, overlays (IK, colliders/touch regions, foot targets, look-at target), director state, per-stage timings | U2 can tune and QA |
| IS-14 | Neutral packages import no three/vue/pinia/stage-ui-*, use VRM humanoid names and rest-relative outputs, and run in Node vitest | U5 reuse |
| IS-15 | MMD settings expose the motion driver (Natural default, Classic), stance clip slots, and Natural energy; en strings in packages/i18n | U1 control |
| IS-16 | READMEs for new packages, updated AGENTS.md/README/skill paths, and one ADR record the architecture | Repo convention |

| id | gap from today | reason | closed by |
|---|---|---|---|
| GAP-1 | Natural lives in stage-ui-live2d and leaks Live2DRigProfile, Live2DTouchRegion, EMOTION_VALUES | prevents reuse | todos (filled at plan time) |
| GAP-2 | Conductor and expression store are Live2D-bound; MMD gets no slots/holds/ACT expressions | U4 | |
| GAP-3 | MMD scene lacks performance/chat/placement/voice props and StagePerformanceScene | IS-2 | |
| GAP-4 | three-mmd applies only vertex morphs | IS-3 | |
| GAP-5 | No rig profile, canonical bones, foot contact, weight shift, look-at, director | IS-5..IS-9 | |
| GAP-6 | Gaze writes after physics; animation manager single-action; three-mmd snapshot compounds relative writes | IS-7 correctness | |
| GAP-7 | frameCamera uses whole Box3 | IS-11 | |
| GAP-8 | No MMD timings, lab, QA scenarios; qa-tools hard-codes the Natural dir | IS-12, IS-13, IS-1 | |
| GAP-9 | MMD settings have no driver/stance slots | IS-15 | |

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
| C1 | Natural extracted to motion-driver-natural; Live2D + qa-tools rewired; trace byte-equal | active | notepad lane natural-blast-radius |
| C2 | MMD frame pipeline (clean snapshot, absolute writes, pre-physics bone stage) + PMX morph runtime | active | three-mmd index.js verified |
| C3 | MMD performance integration: conductor backend port, MMD StagePerformanceScene, MMD expression catalog + shared panel, Stage props | active | lane conductor-coupling |
| C4 | motion-driver-humanoid: canonical types, rig-profile schema, look-at, foot contact + weight shift, stance director | active | lane architect |
| C5 | MMD rig adapter + full-body layers: foot IK targets, look-at writes, rigid-body touch, stance slots, skeleton framing | active | PMX audit |
| C6 | Dev surfaces: MMD Motion Lab, per-stage timings, settings, i18n, docs/ADR | active | |
| -- | Locomotion, window-follow, actions library, perching, VRM adapter (M2-M5) | deferred by Luke's milestone choice | architecture.md section 5 |

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
| Package names | packages/motion-driver-natural, packages/motion-driver-humanoid | repo prefix for pure drivers (motion-driver-magic) | yes |
| Package build | source exports (like stage-shared), no tsdown | tuning loop/HMR, qa-tools tsx, no postinstall build | yes |
| Pure packages and three | no three/vue/pinia/stage-ui-* imports; emit targets; adapters compose quaternions | VRM reuse, Node tests; enforced by eslint no-restricted-imports + package.json | yes |
| Morph runtime home | packages/stage-ui-mmd (supported policy, not workaround) | PMX-specific, needs three + three-mmd materials helpers | yes |
| MMD default driver | Natural on by default; Classic keeps today's gaze/blink/emote path | alive out of the box; Classic = regression escape | yes (setting) |
| Physical touch response | move kinematic head/body bones before physics; no Ammo internals | physics-ammo bodies[] untyped (dist index.js @1840840) | yes |
| Stance thresholds | sit after 120 s continuous mode idle (not watching/talking); sleep while PerformanceState.away; stand on any other mode | reversible tuning constants with NOTICE-free named constants | yes |
| Conductor generalization | renderer-selected expression backend port (Live2D store or MMD store) + scene getter by renderer | removes Live2D binding without compat shims | yes |
| Expression panel | generalize Live2dExpressionsSection to a renderer-neutral snapshot/command contract used by both | one panel (IS-4) | yes |
| Delivery | branch luke/feat/mmd-natural-full-body, atomic commits, PR to lschneiderny/airi | AGENTS.md: plan-sized work on a branch | yes |
| Frame-time budget | 60 fps in Electron stage with standard Chisa; MMD pipeline CPU (excl. render) p95 <= 4 ms | IS-12 | yes |

## Findings (cited - path:lines)
See notepad H:\temp\ulw-20261030-191327.ejIWNp.md lanes natural-blast-radius, conductor-coupling, mmd-qa-physics, architect-boundaries, ultrabrain-details; design C:/Users/Luke/.omo-scratch/3d-motion/architecture.md; PMX audit H:/temp/pmx-audit-popb8wsa/report.md.

## Decisions (with rationale)
- (Luke 2026-10-30) Extract Natural into a shared package.
- (Luke) First milestone = parity + full-body life before walking.
- (Luke) Motion = procedural core + locally imported VMD clips; nothing shipped.
- (Luke) Movement host = window-follow first (not in this plan's scope; M2).

## Scope IN
C1-C6 (Components ledger): M0 + M1.

## Scope OUT (Must NOT have)
- Locomotion, window-follow movement, action/gesture library, LLM perform_action/go_to tools, dance to beat, perching, window-rect sensor, drag-dangle, props, VRM adapter (M2-M5).
- No PMX/VMD/model assets committed; no edits to dirty unrelated files (.agents/skills/*, integrations/vscode).
- No Ammo internals, no re-export shims for moved Natural modules, no changes to Natural numerics during the move.
- No other locales' i18n edits.

## Constraint sweep
- Budget/spend: none (local, no paid services) - explored.
- Mandated stack: Vue 3, three, @moeru/three-mmd, es-toolkit; no new dependencies planned (AGENTS.md: ask before new libraries) - explored.
- Scale: one user, 12 local model variants, Electron on Windows primary; stage-web must keep working - defaulted.
- Audience/compliance: personal fork; model terms forbid redistribution -> no assets in repo; QA uses local paths only - explored (PMX audit).

## Open questions
- (resolved 2026-10-30) Plan scope: M0+M1 only.
- (resolved) Test strategy: TDD for pure math (failing Node tests first for pure layers: look-at, foot contact/leg reach, weight shift, director, morph combine/expansion, pipeline no-drift invariants); tests after for adapters and UI.

## Approval gate
status: approved (Luke, 2026-10-30: "Approve"; Scope M0+M1 only; Tests TDD for pure math)
next action: on Approve -> scaffold plan, plan-consultant, append todos, TL;DR, then plan-reviewer rounds (review_required: true).
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Review ledger
- Plan-consultant (st_01a18f28): 17 findings, all folded in (F1-F17) before round 1.
- Structural self-check: .omo/evidence/mmd-natural-full-body-plan/structure-check.json (0 violations, 23 todos, 4 F rows, 16 IS mapped, 10 GAP closed).
- Round 1: r1-mvvm6ko6, sha aa91fc3b2be45b0de88dabd87bb5323787a44c39dc35c81767650ce53a95598d, session st_01a18f2e -> changes_requested (REJECT). Accepted blockers (ledger frozen): B1 IS-3 vs todo 3 exclusions [explicit_requirement]; B2 todo 1 mutation cannot fail (emotion list only keys strengths, natural-motion.ts:385) [reproducible_broken_flow]; B3 todo 18 QA needs todo 20 UI [reproducible_broken_flow]. Fixes: IS-3 restated to MMD semantics + todo 3 uses three-mmd applyMMDMaterialMorph/applyMMDMaterialState incl. tint uniforms (verified mmd-toon-material dist), UV1-4 explicit no-effect; todo 1 mutation = streamIndex.gaze 4->15; todo 18 assigns slot via mmd store stanceSlots, picker verified in todo 20.
- Round 2: r2-mvvmaorg, sha 488c4befe75ebbdbd21709adb6291d9ab9d049cff957c46d31461105b7392e23, session st_01a18f31 -> changes_requested (REJECT); round-1 blockers B1-B3 not re-raised (closed). New eligible blockers: B4 todo 5 gates.ts imports ./emotions vs empty-diff rule [reproducible_broken_flow]; B5 todo 3 opacity reapply cancels alpha morphs (mmd-materials.ts:80-98) [explicit_requirement IS-3]; B6 todo 5 guard mutation cannot fail (guard.test.ts has no fingerprint) [reproducible_broken_flow]. Fixes: import-line-only rule + diff filter; composeMMDMaterialOpacity override ?? evaluated with 5 browser cases; guard mutation = '// readFileSync' in moved gaze.ts.
- Round 3: r3-mvvmdiyj, sha c3b0747ba564725e796e95d956dc9cda1a810d85c56a29289d609c1e30d30ebd, session st_01a18f33 -> changes_requested (REJECT); B1-B6 not re-raised (closed). New eligible: B7 todo 16 drops emotion->action VMD on Natural (MMD.vue:507-513 vs conductor.ts:226-230) [explicit_requirement IS-10]; B8 600-sample buffers cannot prove 60 s IS-12 [explicit_requirement]. Fixes: Natural setEmotion plays mapped motion + both-driver regression with K4 nod VMD + animation section in diagnostics; start/stopMeasurement full-run aggregation used by todos 4 and 23.
- Round 4: r4-mvvmh4o0, sha 81b0ebfd3c3017ca7630bdab7bd7f85b0e9531a8d04f2945e67bd2686c0a8100, session st_01a18f36 -> changes_requested (REJECT); B1-B8 not re-raised (closed). New eligible: B9 Stage speech-level loop Live2D-only (Stage.vue:709,718,847) so MMD gets no voice level [explicit_requirement IS-2]; B10 todos 10/14 live QA before integration [reproducible_broken_flow]; B11 todo 19 key contradicts todo 14 [contradiction]. Fixes: usesSharedSpeechLevel gate + Stage browser test; live rig QA moved to 12, live catalog QA moved to 16, fixtures-only in 10/14; todo 19 checks expression-catalog:<model id>.
- Round 5: r5-mvvmm0x3, sha 3737bd47cfbad6caa1e3be4424407ebec51e78e1bbfaaee6bde84cf19fd6b73e, session st_01a18f39 -> APPROVED (OKAY, no blockers, no notes). B1-B11 closed. Final live sha 3737bd47cfbad6caa1e3be4424407ebec51e78e1bbfaaee6bde84cf19fd6b73e == approved digest. Structure check: .omo/evidence/mmd-natural-full-body-plan/structure-check-final.json
- Plan change after approval (Luke 2026-10-30, "Worktree + plan guard"): branch guard added to Commit strategy, todo 1 preflight, F1 check. Round-5 approval invalidated by digest change.
- Round 6: r6-mvvmydbo, sha dc3eae1c187daaab5dccee026eb7ed8e7363c7aba0766c0c8c9d7d9a60e2e656, session st_01a18f42 -> changes_requested (REJECT). New eligible: B12 K2/todo 5 hard-code main-checkout controller paths vs worktree branch guard [regression introduced by the guard fix]. Fix: $WT=$(git rev-parse --show-toplevel) of the executing worktree for baseline, post-edit and mutation.
- Round 7: r7-mvvn05gu, sha 8685f79796bcad4e7f55d563980e81e104a533bbf11717d2f549936f3eb9bae2, session st_01a18f43 -> changes_requested (REJECT); B12 closed. New eligible: B13 Electron settings window gets expressions via runtimeSnapshot.live2dExpressions only (live2d.vue:90-101, index.vue:216-289,383-390) [explicit_requirement IS-4]; B14 auto idle on first VMD import (mmd.vue:113-122) invalidates sit transition QA [reproducible_broken_flow]. Fixes: mmdExpressions snapshot + applyMMDExpressionCommand transport, store settings API, K6 cross-window QA, 19 after 16; idle/stance separation rule + stand-at-60s/sit-at-120s QA.
- Round 8: r8-mvvn5tve, sha c248f9a1ceb1f8d78b3199d10a6fcec743f5536cc9e63073ad386d26ba89073e, session st_01a18f48 -> APPROVED (OKAY). B12-B14 closed. Live sha c248f9a1ceb1f8d78b3199d10a6fcec743f5536cc9e63073ad386d26ba89073e == approved.
- Copied plan + draft into C:/Users/Luke/projects/dtuber-wt/mmd-natural-full-body/.omo/ (2026-10-31).
